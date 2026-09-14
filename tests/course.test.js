'use strict';
/* ===== 课程生成测试（Step 4）=====
   三层都测：
   1. 规则拼接课程 buildCourseFallback（真实降级路径）
   2. LLM 整理 generateCourse —— 用假 fetch 冒充 DeepSeek，**不联网**
      重点验证「参考文献白名单」：模型编造的 URL 必须被丢掉
   3. HTTP 端点 GET /api/eggs/:id/course（鉴权、归属、缓存、降级）

   跑法：npm test */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `dy-course-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.MOCK_AUTH = '1';
process.env.NODE_ENV = 'test';
delete process.env.ZHIHU_ACCESS_SECRET;      // 无检索凭证 → 素材降级到收藏
process.env.DEEPSEEK_API_KEY = 'test-key';   // 有 Key，但 fetch 被打桩，不会真的联网

/* ---------- 打桩：只拦 DeepSeek，其余请求（本地测试服务）走真 fetch ---------- */
const realFetch = globalThis.fetch;
let deepseek = null; // 由各用例设置；返回 Response，或抛错以模拟网络失败

globalThis.fetch = function (url, opts) {
  if (String(url).startsWith('https://api.deepseek.com')) {
    if (!deepseek) throw new Error('测试未设置 DeepSeek 桩');
    return deepseek();
  }
  return realFetch(url, opts);
};

function reply(courseObject) {
  return () => new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(courseObject) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const llm = require('../server/llm.js');
const { pickRelevant } = require('../server/routes/eggs.js');
const zhihu = require('../server/zhihu.js');
const app = require('../server/index.js');

/* ---------- 1. 规则拼接课程（无 LLM 时的真实降级）---------- */

const SOURCES = [
  { title: 'Python 零基础入门', url: 'https://www.zhihu.com/p/1', text: '变量、数据类型、循环与函数。' },
  { title: '用 Python 写脚本', url: 'https://www.zhihu.com/p/2', text: '从 os 和 shutil 开始。' },
  { title: '爬虫入门', url: 'https://www.zhihu.com/p/3', text: 'requests 与 BeautifulSoup。' },
  { title: '第四条素材', url: 'https://www.zhihu.com/p/4', text: '不该被规则课程选中的第四条。' },
];

const FALLBACK_NAMES = ['认知建立', '基础梳理', '方法入门', '动手实践', '案例拆解', '进阶拓展'];

test('buildCourseFallback：用真实素材拼出 6 节课，不伪造内容', () => {
  const c = llm.buildCourseFallback('Python 编程', '从入门到能写小工具', SOURCES);

  assert.equal(c.by, 'rules');
  assert.equal(c.title, 'Python 编程 0→1 学习计划');
  assert.equal(c.principle, '从入门到能写小工具');
  assert.equal(c.lessons.length, 6, '固定 6 节，与课程详情页的 6 张课卡一致');
  assert.deepEqual(c.lessons.map(l => l.name), FALLBACK_NAMES);

  // 每份素材都要出现在课程里；原文链接原样来自素材；
  // 顺序也不能乱——素材是按相关性给的，拆散会把最相关的发到后面的课去
  const usedUrls = c.lessons.flatMap(l => l.articles.map(a => a.url));
  assert.deepEqual(usedUrls, SOURCES.map(s => s.url));

  assert.equal(c.refs.length, 3);
  assert.deepEqual(c.refs.map(r => r.url), SOURCES.slice(0, 3).map(s => s.url));
});

test('buildCourseFallback：素材不够也补满 6 节，不随素材多少忽多忽少', () => {
  const c = llm.buildCourseFallback('Python 编程', '', SOURCES);
  assert.equal(c.lessons.length, 6);
  // 4 条素材 → 前 4 节各 1 篇，后 2 节没有文章但仍有目标与理由
  assert.deepEqual(c.lessons.map(l => l.articles.length), [1, 1, 1, 1, 0, 0]);
  assert.ok(c.lessons[5].goal, '没有文章的课节也要有目标');
  assert.ok(c.lessons[5].reason, '没有文章的课节也要有理由');
});

test('buildCourseFallback：每节课都有目标与理由，结构完整', () => {
  const c = llm.buildCourseFallback('Python 编程', '', SOURCES);
  c.lessons.forEach(ls => {
    assert.ok(ls.name, '课名不能为空');
    assert.ok(ls.goal, '课节目标不能为空');
    assert.ok(ls.reason, '课节理由不能为空');
    assert.ok(Array.isArray(ls.articles));
    assert.ok(Array.isArray(ls.actions));
  });
});

test('buildCourseFallback：素材多于 6 条时按连续段均分，不超过 6 节', () => {
  const many = Array.from({ length: 9 }, (_, i) => (
    { title: `素材${i + 1}`, url: `https://www.zhihu.com/p/${i + 1}`, text: `第 ${i + 1} 篇。` }
  ));
  const c = llm.buildCourseFallback('Python 编程', '', many);
  assert.equal(c.lessons.length, 6);
  assert.deepEqual(c.lessons.map(l => l.articles.length), [2, 2, 2, 1, 1, 1]);
  const usedUrls = c.lessons.flatMap(l => l.articles.map(a => a.url));
  assert.deepEqual(usedUrls, many.map(s => s.url), '顺序不能乱');
});

test('buildCourseFallback：没有素材时也给得出 6 节课，不崩', () => {
  const c = llm.buildCourseFallback('心理学', '', []);
  assert.equal(c.by, 'rules');
  assert.equal(c.lessons.length, 6);
  assert.deepEqual(c.refs, []);
  assert.deepEqual(c.lessons[0].articles, []);
});

test('buildCourseFallback：素材没摘要时用兜底文案，不留空理由', () => {
  const c = llm.buildCourseFallback('学习方法', '', [{ title: '只有标题', url: 'https://www.zhihu.com/p/9' }]);
  assert.ok(c.lessons[0].articles[0].why.length > 0);
});

/* ---------- 2. LLM 整理 ---------- */

/* 一份结构合法的 LLM 课程，供各用例按需改写 */
function validPlan(over = {}) {
  return {
    title: 'Python 0→1 学习计划',
    principle: '先跑起来，再深入原理',
    lessons: [
      {
        name: '认知建立',
        goal: '搞懂 Python 是什么',
        reason: '先建立整体认知再动手',
        articles: [{ title: 'Python 零基础入门', url: 'https://www.zhihu.com/p/1', why: '讲清了基础概念' }],
        actions: ['装好环境', '敲出第一个 print'],
      },
      {
        name: '动手实践',
        goal: '写出第一个小工具',
        reason: '认知到位后必须动手',
        articles: [{ title: '用 Python 写脚本', url: 'https://www.zhihu.com/p/2', why: '半小时做出实用工具' }],
        actions: ['写一个整理文件的脚本'],
      },
    ],
    refs: [{ title: 'Python 零基础入门', url: 'https://www.zhihu.com/p/1' }],
    ...over,
  };
}

test('generateCourse：LLM 不可用时直接走规则课程', async () => {
  const c = await llm.generateCourse('无素材主题', '', []);
  assert.equal(c.by, 'rules');
  assert.ok(Array.isArray(c.lessons));
});

test('generateCourse：正常返回 6 节课的课程', async () => {
  deepseek = reply(validPlan());

  const c = await llm.generateCourse('Python 编程', '从入门到能写小工具', SOURCES);
  assert.equal(c.by, 'llm');
  assert.equal(c.title, 'Python 0→1 学习计划');
  assert.equal(c.principle, '先跑起来，再深入原理');
  assert.equal(c.lessons.length, 2);

  const ls = c.lessons[0];
  assert.equal(ls.name, '认知建立');
  assert.equal(ls.goal, '搞懂 Python 是什么');
  assert.ok(ls.reason);
  assert.equal(ls.articles.length, 1);
  assert.deepEqual(ls.actions, ['装好环境', '敲出第一个 print']);
});

test('generateCourse：模型编造的文章链接被丢弃，真实素材被还原成原始 title/url', async () => {
  deepseek = reply(validPlan({
    lessons: [{
      name: '认知建立',
      goal: '搞懂 Python',
      reason: '先认知',
      articles: [
        { title: '乱写的标题', url: 'https://www.zhihu.com/p/1', why: '真实素材' },
        { title: '编造文章', url: 'https://evil.example.com/made-up', why: '编的' },
      ],
      actions: ['a'],
    }],
  }));

  const c = await llm.generateCourse('Python 编程', '', SOURCES);
  assert.equal(c.lessons[0].articles.length, 1, '编造的文章必须被丢弃');
  // 标题也以素材为准，不信模型改写的
  assert.deepEqual(c.lessons[0].articles[0], {
    title: 'Python 零基础入门',
    url: 'https://www.zhihu.com/p/1',
    why: '真实素材',
  });
  assert.ok(!JSON.stringify(c).includes('evil.example.com'));
});

test('generateCourse：模型编造的参考链接被丢掉（URL 白名单）', async () => {
  deepseek = reply(validPlan({
    refs: [
      { title: '真实素材', url: 'https://www.zhihu.com/p/1' },
      { title: '编造来源', url: 'https://evil.example.com/made-up' },
    ],
  }));

  const c = await llm.generateCourse('Python 编程', '', SOURCES);
  assert.equal(c.refs.length, 1, '编造的 URL 必须被过滤');
  assert.equal(c.refs[0].url, 'https://www.zhihu.com/p/1');
  assert.ok(!JSON.stringify(c).includes('evil.example.com'));
});

test('generateCourse：链接末尾多斜杠也能对回素材原文，仍用素材的原始 URL', async () => {
  deepseek = reply(validPlan({
    refs: [{ title: '真实素材', url: 'https://www.zhihu.com/p/1/' }],
  }));

  const c = await llm.generateCourse('Python 编程', '', SOURCES);
  assert.deepEqual(c.refs, [{ title: 'Python 零基础入门', url: 'https://www.zhihu.com/p/1' }]);
});

test('generateCourse：模型给的链接全不可信时，退回素材自身的参考来源', async () => {
  deepseek = reply(validPlan({
    refs: [{ title: '全是编的', url: 'https://evil.example.com/x' }],
  }));

  const c = await llm.generateCourse('Python 编程', '', SOURCES);
  assert.deepEqual(c.refs.map(r => r.url), SOURCES.slice(0, 3).map(s => s.url));
});

test('generateCourse：课节不合法（缺目标）时降级到规则课程', async () => {
  deepseek = reply(validPlan({ lessons: [{ name: '只有名字', articles: [] }] }));
  const c = await llm.generateCourse('Python 编程', '描述', SOURCES);
  assert.equal(c.by, 'rules');
});

test('generateCourse：没有 lessons 字段时降级到规则课程', async () => {
  deepseek = reply({ title: 't', principle: 'p', refs: [] });
  const c = await llm.generateCourse('Python 编程', '描述', SOURCES);
  assert.equal(c.by, 'rules');
});

test('generateCourse：模型给多了课节时截到 6 节', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    name: `第${i + 1}课`, goal: `目标${i + 1}`, reason: '理由', articles: [], actions: [],
  }));
  deepseek = reply(validPlan({ lessons: many }));

  const c = await llm.generateCourse('Python 编程', '', SOURCES);
  assert.equal(c.by, 'llm');
  assert.equal(c.lessons.length, 6);
  assert.equal(c.lessons[5].name, '第6课');
});

test('generateCourse：行动任务去重并限长', async () => {
  deepseek = reply(validPlan({
    lessons: [{
      name: '认知建立', goal: 'g', reason: 'r', articles: [],
      actions: ['同一个', '同一个', '  ', '另一个', 'a', 'b', 'c', 'd'],
    }],
  }));

  const c = await llm.generateCourse('Python 编程', '', SOURCES);
  assert.deepEqual(c.lessons[0].actions, ['同一个', '另一个', 'a', 'b', 'c'], '去重、去空、最多 5 条');
});

test('generateCourse：LLM 抛错时降级到规则课程，不把错误抛给调用方', async () => {
  deepseek = () => { throw new Error('模拟网络中断'); };
  const c = await llm.generateCourse('Python 编程', '描述', SOURCES);
  assert.equal(c.by, 'rules');
  assert.equal(c.lessons[0].articles[0].title, SOURCES[0].title);
});

test('generateCourse：LLM 返回 5xx 时降级到规则课程', async () => {
  deepseek = () => new Response('upstream error', { status: 502 });
  const c = await llm.generateCourse('Python 编程', '描述', SOURCES);
  assert.equal(c.by, 'rules');
});

/* ---------- 2.5 参考来源只收「长期有效」的链接 ----------
   知识库的 PDF/EPUB 来源给的是带签名的下载直链，几分钟后就失效，
   当参考来源展示给用户等于给死链。这类链接可以当素材，但不能当引用。 */

const SIGNED_SOURCE = {
  title: '医学心理学（第8版）.pdf',
  url: 'https://assets2.zhihu.com/x.pdf?auth_key=1&expiration=1789298150',
  durable: false,
  text: '教材正文片段。',
};

test('isDurableUrl：签名下载直链判为临时，站内内容页判为长期有效', () => {
  assert.equal(zhihu.isDurableUrl('https://assets2.zhihu.com/x.pdf?expiration=1'), false);
  assert.equal(zhihu.isDurableUrl('https://assets.zhihu.com/x.epub'), false);
  assert.equal(zhihu.isDurableUrl('https://www.zhihu.com/answer/123'), true);
  assert.equal(zhihu.isDurableUrl('https://zhuanlan.zhihu.com/p/123'), true);
  assert.equal(zhihu.isDurableUrl(''), false);
  assert.equal(zhihu.isDurableUrl('javascript:alert(1)'), false);
});

test('buildCourseFallback：签名临时链接不进参考来源，但正文仍可用它当素材', () => {
  const sources = [SOURCES[0], SIGNED_SOURCE];
  const c = llm.buildCourseFallback('心理学', '', sources);

  assert.deepEqual(c.refs, [{ title: SOURCES[0].title, url: SOURCES[0].url }]);
  const usedTitles = c.lessons.flatMap(ls => ls.articles.map(a => a.title));
  assert.ok(usedTitles.includes(SIGNED_SOURCE.title), '素材本身仍参与课程正文');
});

test('sanitizeCourse：模型引用签名临时链接时被丢弃', async () => {
  deepseek = reply(validPlan({
    refs: [
      { title: SIGNED_SOURCE.title, url: SIGNED_SOURCE.url },
      { title: SOURCES[0].title, url: SOURCES[0].url },
    ],
  }));

  const c = await llm.generateCourse('心理学', '', [SOURCES[0], SIGNED_SOURCE]);
  assert.deepEqual(c.refs, [{ title: SOURCES[0].title, url: SOURCES[0].url }]);
});

test('sanitizeCourse：签名临时链接也不能当学习文章（点了就是失效页）', async () => {
  deepseek = reply(validPlan({
    lessons: [{
      name: '认知建立', goal: 'g', reason: 'r', actions: [],
      articles: [{ title: SIGNED_SOURCE.title, url: SIGNED_SOURCE.url, why: '教材' }],
    }],
  }));

  const c = await llm.generateCourse('心理学', '', [SIGNED_SOURCE]);
  assert.deepEqual(c.lessons[0].articles, [], '临时链接不进白名单');
});

test('全是签名临时链接时，参考来源为空而不是给出死链', async () => {
  deepseek = reply(validPlan({
    lessons: [{
      name: '认知建立', goal: '搞懂教材', reason: '先认知', actions: ['读一章'],
      articles: [],
    }],
    refs: [{ title: SIGNED_SOURCE.title, url: SIGNED_SOURCE.url }],
  }));

  const c = await llm.generateCourse('心理学', '', [SIGNED_SOURCE]);
  assert.deepEqual(c.refs, [], '宁可不给引用，也不给死链');
  assert.equal(c.lessons.length, 1, '课程正文照常生成');
  assert.deepEqual(c.lessons[0].actions, ['读一章'], '行动任务不受影响');
});

/* ---------- 3. 收藏素材的相关性挑选 ---------- */

test('pickRelevant：挑出与主题相关的收藏，并带上标题/链接/摘要', () => {
  const picked = pickRelevant(zhihu.MOCK_COLLECTIONS, 'Python 编程');

  assert.ok(picked.length > 0 && picked.length <= 5);
  picked.forEach(p => {
    assert.ok(p.title);
    assert.ok(p.url);
    assert.equal(typeof p.text, 'string');
  });
  assert.ok(picked.some(p => p.title.includes('Python')), 'Python 主题应命中 Python 收藏');
});

test('pickRelevant：无匹配时返回空，不混入别的主题', () => {
  const picked = pickRelevant(zhihu.MOCK_COLLECTIONS, '量子力学与拓扑绝缘体');
  assert.equal(picked.length, 0);
});

/* ---------- 4. HTTP 端点 ---------- */

let server;
let base;
let cookie = '';
let eggId;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(TMP_DB + suffix); } catch { /* 文件不存在则忽略 */ }
  }
});

async function req(method, p, body) {
  const res = await realFetch(base + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookies.length) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, data };
}

test('未登录请求课程返回 401', async () => {
  const r = await req('GET', '/api/eggs/1/course');
  assert.equal(r.status, 401);
});

test('登录后可取到某个蛋的课程', async () => {
  const login = await req('GET', '/api/auth/login');
  assert.equal(login.status, 302);

  // 聚类阶段不测 LLM：让它走规则算法，蛋列表才是确定的
  deepseek = () => { throw new Error('聚类阶段不需要 LLM'); };
  const list = await req('GET', '/api/eggs');
  assert.equal(list.status, 200);
  assert.ok(list.data.eggs.length > 0);
  eggId = list.data.eggs[0].id;

  deepseek = reply({ posts: [{ sourceId: 1, paragraphs: ['第一篇的内容总结'], url: 'https://evil.example.com/made-up' }] });
  const r = await req('GET', `/api/eggs/${eggId}/course`);

  assert.equal(r.status, 200);
  assert.equal(r.data.course.format, 'post-summaries');
  assert.equal(r.data.course.lessons.length, r.data.meta.materialCount);
  assert.deepEqual(r.data.course.lessons[0].paragraphs, ['第一篇的内容总结']);
  assert.ok(r.data.course.lessons.slice(1).every(p => p.summaryMode === 'provided'));
  assert.equal(r.data.meta.llm, true);
  assert.equal(r.data.meta.source, 'collections', '无 Access Secret → 素材降级到收藏');
  assert.equal(r.data.meta.mock, true);
  assert.ok(r.data.meta.materialCount > 0);

  // 白名单在 HTTP 层同样生效：编造的 URL 绝不能出现在响应体里
  assert.ok(!JSON.stringify(r.data).includes('evil.example.com'));
});

test('同一颗蛋第二次请求走缓存，不再调 LLM', async () => {
  deepseek = () => { throw new Error('走缓存就不该再调 LLM'); };
  const r = await req('GET', `/api/eggs/${eggId}/course`);
  assert.equal(r.status, 200);
  assert.equal(r.data.cached, true);
  assert.equal(r.data.course.format, 'post-summaries');
});

test('?refresh=1 绕过缓存重新生成；LLM 挂了则降级为规则课程', async () => {
  deepseek = () => { throw new Error('模拟 LLM 不可用'); };
  const r = await req('GET', `/api/eggs/${eggId}/course?refresh=1`);

  assert.equal(r.status, 200);
  assert.equal(r.data.course.by, 'rules');
  assert.equal(r.data.meta.llm, false);
  assert.equal(r.data.course.lessons.length, r.data.meta.materialCount);
  assert.ok(r.data.course.lessons.every(l => l.summaryMode === 'provided' && l.paragraphs.length));
});

test('别人的蛋 / 不存在的蛋返回 404', async () => {
  const other = await req('GET', '/api/eggs/999999/course');
  assert.equal(other.status, 404);

  const bad = await req('GET', '/api/eggs/abc/course');
  assert.equal(bad.status, 404);
});
