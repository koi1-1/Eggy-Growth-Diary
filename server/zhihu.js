'use strict';
/* ===== 知乎用户数据 API：读取授权用户的收藏（Step 3）=====
   双凭证：Authorization: Bearer <Access Secret>（鉴权调用方）
          X-OAuth-Token: <用户 OAuth token>（指明代表哪个用户）
   安全红线：Access Secret 与 OAuth Token 仅服务端使用，
            绝不进前端、URL、日志或错误信息。
   协议依据：~/.claude/skills/zhihu/references/user-api.md */

const BASE = 'https://developer.zhihu.com';
const ACCESS_SECRET = process.env.ZHIHU_ACCESS_SECRET || '';

/* 收藏接口只有标题 + 摘要，没有任意收藏帖全文；课程只使用这些字段。 */
function isUserApiConfigured() {
  return Boolean(ACCESS_SECRET);
}

/* 把接口返回的条目归一化成内部结构 */
function normalizeItem(it) {
  if (!it || typeof it.Title !== 'string' || !it.Title.trim()) return null;
  return {
    title: it.Title.trim(),
    summary: String(it.Summary || ''),
    url: String(it.Url || ''),
    type: String(it.ContentType || ''),
  };
}

/* 读取「近期收藏」——单次调用、无分页，适合 MVP 快速拿到一批兴趣样本 */
async function fetchRecentCollections(oauthToken, limit = 50) {
  const url = new URL('/api/v1/user/collections', BASE);
  url.searchParams.set('Limit', String(Math.min(limit, 50)));

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ACCESS_SECRET}`,
        'X-OAuth-Token': oauthToken,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('读取收藏失败：无法连接知乎开放平台');
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('读取收藏失败：响应格式异常'); }

  if (!res.ok) throw new Error(`读取收藏失败：HTTP ${res.status}`);
  // 业务码：0 成功；20001 鉴权失败；30001/30002 频率或配额限制
  if (data.Code !== 0) throw new Error(`读取收藏失败：业务码 ${data.Code}`);

  if (!Array.isArray(data.Data?.Items)) throw new Error('读取收藏失败：响应缺少收藏列表');
  const items = data.Data.Items.map(normalizeItem);
  if (items.some(it => !it)) throw new Error('读取收藏失败：条目缺少有效标题');
  const seen = new Set();
  return items.filter(it => {
    const key = it.url || it.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ---------- 知识库 RAG 检索（课程素材主来源）----------
   只需 Access Secret（Bearer），不需要用户的 OAuth Token。
   检索范围用 public（知乎公开知识库），覆盖任意主题、含正文片段。
   协议依据：~/.claude/skills/zhihu/references/http-api.md「知识库检索 API」 */

const KNOWLEDGE_SEARCH_URL = `${BASE}/api/v1/knowledge/search`;

/* 知识库结果里的「文档」类来源（PDF/EPUB/MD）给的是带签名的下载直链
   （assets*.zhihu.com/?auth_key=...&expiration=...），链接本身带过期时间，
   几分钟到一小时后打开就是失效页。知乎站内的内容页链接才是长期有效的。
   只有长期有效的链接才适合当「参考来源」展示给用户。 */
function isDurableUrl(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  return !/^https?:\/\/assets\d*\.zhihu\.com\//i.test(u);
}

/* 把检索结果归一化成课程素材：{ title, url, text, durable }
   Content 是同一文档命中的有序片段数组，拼接后作为该素材的正文 */
function normalizeSearchItem(it) {
  if (!it || !it.DocName) return null;
  const chunks = Array.isArray(it.Content) ? it.Content.map(String).filter(Boolean) : [];
  const text = chunks.join('\n').trim();
  if (!text) return null; // 没有正文片段的条目对课程生成没用
  const url = String(it.OriginUrl || '');
  return {
    title: String(it.DocName),
    url,
    durable: isDurableUrl(url), // false = 签名临时链接，可作素材但不作参考来源
    text,
  };
}

/* 未配置 Access Secret 时返回 null，由上层降级到「用收藏做素材」 */
async function searchKnowledge(query, { limit = 6 } = {}) {
  if (!isUserApiConfigured() || !query) return null;

  let res;
  try {
    res = await fetch(KNOWLEDGE_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_SECRET}`,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Query: String(query),
        RecallScopes: ['public'],
        Limit: Math.min(Math.max(Number(limit) || 6, 1), 10), // 接口限定 1..10
      }),
    });
  } catch {
    throw new Error('知识库检索失败：无法连接知乎开放平台');
  }

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('知识库检索失败：响应格式异常'); }

  if (!res.ok) throw new Error(`知识库检索失败：HTTP ${res.status}`);
  // 0 成功；20001 鉴权失败 / 无权限；30001 频率或额度受限；50002 检索失败
  if (data.Code !== 0) throw new Error(`知识库检索失败：业务码 ${data.Code}`);

  const items = ((data.Data && data.Data.Items) || []).map(normalizeSearchItem).filter(Boolean);

  // 同一份文档会被多个片段分别命中而重复返回（实测有一份 EPUB 一次返回 3 条），
  // 按标题去重，免得课程把同一份材料讲好几遍、也白白多占 prompt
  const seen = new Set();
  return items.filter(it => !seen.has(it.title) && seen.add(it.title));
}

/* ---------- 开发用假收藏（仅在未配置 Access Secret 时使用）---------- */
const MOCK_COLLECTIONS = [
  { title: 'Python 零基础入门，先搞懂这几个概念', summary: '变量、数据类型、循环与函数，新手最容易卡的几个点。', url: 'https://www.zhihu.com/p/1', type: 'article' },
  { title: '用 Python 写一个自动整理文件的脚本', summary: '从 os 和 shutil 开始，半小时做出第一个实用小工具。', url: 'https://www.zhihu.com/p/2', type: 'article' },
  { title: '爬虫入门：requests 与 BeautifulSoup 怎么配合', summary: '请求、解析、存数据三步走，附常见反爬应对思路。', url: 'https://www.zhihu.com/p/3', type: 'answer' },
  { title: '为什么你总是拖延？心理学给出了解释', summary: '拖延不是懒，而是情绪调节失败。理解它才能改变它。', url: 'https://www.zhihu.com/p/4', type: 'answer' },
  { title: '认知失调：人为什么会自我欺骗', summary: '当行为与信念冲突时，大脑如何自动找理由说服自己。', url: 'https://www.zhihu.com/p/5', type: 'article' },
  { title: '情绪管理不是压抑，而是识别', summary: '给情绪命名的能力，决定了你能否与它共处。', url: 'https://www.zhihu.com/p/6', type: 'pin' },
  { title: '考研英语阅读，长难句到底怎么拆', summary: '找主干、辨从句、理修饰，三步拆开任何长句。', url: 'https://www.zhihu.com/p/7', type: 'article' },
  { title: '背单词的十个误区，你中了几个', summary: '脱离语境的死记硬背，为什么记了又忘。', url: 'https://www.zhihu.com/p/8', type: 'answer' },
  { title: '考研英语写作模板，怎么用才不像模板', summary: '框架是骨架，内容要自己长肉。附高分替换表达。', url: 'https://www.zhihu.com/p/9', type: 'article' },
  { title: '费曼学习法：讲不出来就是没学会', summary: '用最简单的话复述，暴露理解漏洞，再回头补。', url: 'https://www.zhihu.com/p/10', type: 'answer' },
  { title: '为什么专注这么难？注意力机制解析', summary: '大脑天生爱分心，专注是需要设计的，不是靠意志力。', url: 'https://www.zhihu.com/p/11', type: 'article' },
  { title: '间隔重复：把复习安排在遗忘前', summary: '艾宾浩斯曲线的正确用法，以及怎么排复习计划。', url: 'https://www.zhihu.com/p/12', type: 'article' },
  { title: '怎么做一份能执行下去的计划', summary: '把「我要努力」翻译成「几点做什么」，计划才有效。', url: 'https://www.zhihu.com/p/13', type: 'answer' },
  { title: '目标拆解：从年计划到日清单', summary: '大目标要拆到能在今天动手的粒度，否则永远停在纸面。', url: 'https://www.zhihu.com/p/14', type: 'article' },
  { title: '时间管理的本质是精力管理', summary: '同样的两小时，状态不同产出差十倍。先管精力。', url: 'https://www.zhihu.com/p/15', type: 'pin' },
  { title: '实习第一周，怎么快速融入团队', summary: '先摸清协作方式，再证明能力，别急着表现。', url: 'https://www.zhihu.com/p/16', type: 'answer' },
  { title: '职场沟通：把问题说清楚的能力', summary: '结论先行、分层展开，让对方三句话听懂你的意思。', url: 'https://www.zhihu.com/p/17', type: 'article' },
  { title: '校招简历怎么写才能过筛', summary: 'HR 只看 20 秒，把结果和数字放在最前面。', url: 'https://www.zhihu.com/p/18', type: 'answer' },
];

/* 未配置凭证、或当前会话没有 OAuth Token（如 Mock 登录）时返回假收藏，
   让前端与聚类逻辑可以先行开发验证 */
function readCollections(oauthToken, { allowMock = false } = {}) {
  if (allowMock && process.env.NODE_ENV !== 'production') {
    return Promise.resolve({ items: MOCK_COLLECTIONS, mock: true });
  }
  if (!isUserApiConfigured()) throw new Error('读取收藏失败：服务端未配置收藏接口凭证');
  if (!oauthToken) throw new Error('读取收藏失败：当前会话缺少知乎授权，请重新连接知乎');
  return fetchRecentCollections(oauthToken).then(items => ({ items, mock: false }));
}

module.exports = {
  isUserApiConfigured,
  fetchRecentCollections,
  readCollections,
  searchKnowledge,
  isDurableUrl,
  MOCK_COLLECTIONS,
};
