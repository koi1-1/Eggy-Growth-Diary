'use strict';
/* ===== LLM 流水线（Step 3：聚类蛋；Step 4 起加「整理课程 / 出复习题」）=====
   选型：DeepSeek（deepseek-chat）
   安全：API Key 仅服务端使用，绝不进前端、日志或错误信息。
   降级：未配置 Key → 规则聚类；调用失败 → 同样降级到规则聚类。
        两者都是真实算法，不伪造内容。 */

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function isLLMConfigured() {
  return Boolean(API_KEY);
}

/* ---------- 规则聚类（无 LLM 时的真实降级方案）---------- */
const TOPICS = [
  { theme: 'Python 编程', desc: '从入门到能写小工具', keywords: ['python', '爬虫', '编程', '代码', '脚本', '函数', 'requests', 'beautifulsoup'] },
  { theme: '心理学',      desc: '认知、情绪与自我成长', keywords: ['心理', '情绪', '认知', '焦虑', '拖延', '自我', '失调'] },
  { theme: '考研英语',    desc: '词汇、阅读与写作',    keywords: ['英语', '单词', '考研', '阅读', '写作', '长难句', '语法'] },
  { theme: '学习方法',    desc: '高效学习与专注',      keywords: ['学习', '记忆', '复习', '专注', '费曼', '间隔', '遗忘'] },
  { theme: '目标管理',    desc: '设定与达成目标',      keywords: ['目标', '计划', '时间管理', '精力', '习惯', '拆解'] },
  { theme: '职场成长',    desc: '从校园到职场',        keywords: ['职场', '实习', '简历', '沟通', '面试', '校招', '团队'] },
];

/* 冷启动：无收藏时的推荐主题蛋 */
const RECOMMENDED_EGGS = [
  { theme: '学习方法',   desc: '高效学习与专注' },
  { theme: 'Python 编程', desc: '从入门到能写小工具' },
  { theme: '心理学',     desc: '认知、情绪与自我成长' },
  { theme: '考研英语',   desc: '词汇、阅读与写作' },
  { theme: '职场成长',   desc: '从校园到职场' },
];

const TONE_COUNT = 6;

/* 给蛋排大小：命中收藏越多的主题，气泡越大（呼应气泡墙的错落感）
   按「下标」排名而非主题名——主题名重复时也能正确区分 */
function decorate(eggs, items) {
  const texts = items.map(it => `${it.title} ${it.summary}`.toLowerCase());

  const withCount = eggs.map(e => {
    const kws = (e.keywords || []).map(k => String(k).toLowerCase()).filter(Boolean);
    const count = kws.length
      ? texts.filter(t => kws.some(k => t.includes(k))).length
      : 0;
    return { ...e, count };
  });

  // 命中多的排前；相同则保持原顺序（sort 稳定）
  const order = withCount
    .map((_, i) => i)
    .sort((a, b) => (withCount[b].count - withCount[a].count) || (a - b));
  const rankOf = new Map(order.map((idx, rank) => [idx, rank]));

  return withCount.map((e, i) => {
    const rank = rankOf.get(i);
    return {
      theme: e.theme,
      desc: e.desc || '',
      keywords: e.keywords || [],
      count: e.count,
      size: rank === 0 ? 'lg' : rank <= 2 ? 'md' : 'sm',
      tone: (i % TONE_COUNT) + 1,
    };
  });
}

/* LLM 可能返回重名主题，去重后保留先出现的 */
function dedupeThemes(eggs) {
  const seen = new Set();
  return eggs.filter(e => {
    const key = e.theme.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clusterByRules(items) {
  const texts = items.map(it => `${it.title} ${it.summary}`.toLowerCase());
  const hit = TOPICS.map(t => ({
    theme: t.theme,
    desc: t.desc,
    keywords: t.keywords,
    count: texts.filter(x => t.keywords.some(k => x.includes(k))).length,
  })).filter(t => t.count > 0);

  const picked = hit.length ? hit : RECOMMENDED_EGGS.map(e => ({ ...e, keywords: [], count: 0 }));
  return decorate(picked, items);
}

/* ---------- LLM 聚类 ---------- */
const CLUSTER_SYSTEM = `你是知识内容整理助手。用户给你一批知乎收藏的标题与摘要，请归纳成 3-6 个「兴趣主题」。

要求：
1. 主题名简短（4-8 个汉字），是用户一眼能看懂的知识领域，不要照抄某一条标题
2. 每个主题配一句 12 字以内的描述
3. 每个主题给 3-6 个关键词，用于把收藏归入该主题（小写，中英文均可）
4. 主题要覆盖大部分收藏，不要遗漏明显的大类
5. 只输出 JSON，不要任何解释文字`;

/* 调用 DeepSeek，返回解析后的对象；失败抛错由上层降级 */
async function chatJSON(system, userContent, { temperature = 0.3, maxTokens = 1200 } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
  } catch {
    throw new Error('LLM 调用失败：无法连接服务');
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`LLM 调用失败：HTTP ${res.status}`);

  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('LLM 调用失败：响应格式异常'); }

  const content = payload && payload.choices && payload.choices[0]
    && payload.choices[0].message && payload.choices[0].message.content;
  if (!content) throw new Error('LLM 调用失败：响应缺少内容');

  return parseJSONLoose(content);
}

/* 容错解析：模型偶尔仍会包 ```json 围栏 */
function parseJSONLoose(text) {
  const cleaned = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* 继续抛错 */ }
    }
    throw new Error('LLM 调用失败：返回内容不是合法 JSON');
  }
}

/* 聚类入口：LLM 优先，失败或未配置则降级到规则聚类 */
async function clusterThemes(items) {
  if (!items || items.length === 0) {
    // 冷启动：无收藏 → 推荐主题蛋
    return decorate(RECOMMENDED_EGGS.map(e => ({ ...e, keywords: [], count: 0 })), []);
  }

  if (!isLLMConfigured()) {
    return clusterByRules(items);
  }

  const list = items.map((it, i) => `${i + 1}. ${it.title}｜${it.summary}`).join('\n');
  const prompt = `以下是一位知乎用户最近收藏的 ${items.length} 条内容（格式：序号. 标题｜摘要）：\n\n${list}\n\n` +
    `请归纳成 3-6 个兴趣主题，按 JSON 输出：{"eggs":[{"theme":"主题名","desc":"一句话描述","keywords":["关键词1","关键词2"]}]}`;

  try {
    const data = await chatJSON(CLUSTER_SYSTEM, prompt);
    const raw = Array.isArray(data && data.eggs) ? data.eggs : [];
    const eggs = dedupeThemes(raw
      .filter(e => e && e.theme)
      .map(e => ({
        theme: String(e.theme).slice(0, 20),
        desc: String(e.desc || '').slice(0, 30),
        keywords: Array.isArray(e.keywords) ? e.keywords.map(String).slice(0, 8) : [],
      })))
      .slice(0, 6);
    if (eggs.length === 0) throw new Error('LLM 返回的主题为空');
    return decorate(eggs, items);
  } catch (err) {
    // 降级到规则聚类（真实算法，不伪造内容）
    console.warn('[llm] 聚类失败，降级为规则聚类：', err.message);
    return clusterByRules(items);
  }
}

/* ---------- 课程生成（Step 4；Step 4.1 改分阶段；Step 4.2 改 6 节课）----------
   素材（知识库检索片段 或 用户收藏）→ 一门 0→1 的 6 节课课程。
   课程形态思路来自 design/学习计划_通用模板.md、学习计划_配置指南.md：
     · 先定「核心原则」，再按三个维度把内容排成递进课节
       维度一 认知深度递进：知道 → 做到
       维度二 行动门槛递进：不花钱/纯认知 → 动手实践 → 持续投入
       维度三 内容主题与该节课目标匹配
     · 每节课 = 目标 + 为什么排在这里 + 学习文章（带「为什么选它」）+ 行动任务
   两份设计文件里用「赞同数×1 + 评论数×2」加权筛文章，但知识库检索接口
   只返回正文片段 / DocName / OriginUrl，**没有点赞评论数据**，因此不做该项筛选：
   素材顺序沿用检索自身的相关性，由 LLM 按主题匹配度分配到各节课并给出选择理由。

   红线：文章与参考来源的 title/url 只允许取自素材，禁止编造 URL —— 由白名单强制。 */

const COURSE_SYSTEM = `你是学习路径设计助手。用户给你一个学习主题和一批知乎参考资料（含标题、正文片段、原文链接）。
请把这些资料组织成一份**面向零基础学习者的 0→1 课程**，拆成 6 节课，帮读者按正确顺序、一节一节学下去。

排课的三个维度（必须同时满足）：
1. 认知深度递进：从「知道是什么」到「能动手做」，前面的课是后面的课的基础
2. 行动门槛递进：越靠前的课行动成本越低（先纯阅读认知，再动手实践，最后持续深入）
3. 主题匹配：每节课安排的文章，其内容主题要与该节课的目标一致

要求：
1. 中文输出，语言平实、面向初学者
2. principle：一句话说清这门课的排课原则（例如「先守钱，再增值」「先跑起来，再深入原理」）
3. lessons：**固定 6 节**，按学习顺序排列，覆盖完整 0→1 路径（如：认知建立 → 概念梳理 → 方法入门 → 动手实践 → 案例拆解 → 进阶拓展）。每节包含：
   - name：课名（4-8 字）
   - goal：这一节学完能达到什么，一句话
   - reason：为什么这一节排在这里（为什么先学 / 为什么现在才学），一句话
   - articles：从给定资料里选 1-2 条作为本节课的学习文章，url **必须原样取自资料，严禁编造、改写或拼接**
     · why：选这篇的理由，说明它的内容为什么适合这一节
   - actions：2-3 个学完这一节要做的具体行动任务，短句、可执行（如「敲出第一个 print」）
4. refs：从给定资料中挑 2-4 条作为参考来源。title 与 url **必须原样取自资料，严禁编造**
5. 只输出 JSON，不要任何解释文字

输出格式：
{"title":"XX 0→1 学习计划","principle":"一句话原则","lessons":[{"name":"认知建立","goal":"...","reason":"...","articles":[{"title":"资料标题","url":"资料链接","why":"选它的理由"}],"actions":["行动1","行动2"]}],"refs":[{"title":"资料标题","url":"资料链接"}]}`;

const MAX_SOURCE_CHARS = 1200; // 单条素材截断，控制 prompt 长度
const MAX_LESSONS = 6;         // 一门课固定 6 节，与课程详情页的课卡网格一致

function formatSources(sources) {
  return sources
    .map((s, i) => {
      const text = String(s.text || s.summary || '').slice(0, MAX_SOURCE_CHARS);
      return `${i + 1}. 标题：${s.title}\n   链接：${s.url || '（无）'}\n   内容：${text || '（无正文）'}`;
    })
    .join('\n\n');
}

/* 降级用的课节骨架：无 LLM 时按固定的递进档位切分素材，凑成 6 节课。
   课名/目标/理由都是模板文案，文章则一律是真实素材，不伪造内容。 */
const FALLBACK_LESSONS = [
  { name: '认知建立', goal: (t) => `搞懂${t}是什么、能解决什么问题`, reason: '先建立整体认知，再动手，避免一上来就卡在细节里' },
  { name: '基础梳理', goal: (t) => `理清${t}的核心概念与它们之间的关系`, reason: '概念混淆是最常见的卡点，先理顺再往下学' },
  { name: '方法入门', goal: (t) => `掌握学${t}的基本方法，知道该从哪里下手`, reason: '有了概念还要有方法，否则不知道下一步做什么' },
  { name: '动手实践', goal: (t) => `把${t}用起来，做出第一个小成果`, reason: '认知到位后必须动手，否则只停留在「看过」' },
  { name: '案例拆解', goal: (t) => `看懂别人怎么用${t}，把别人的经验变成自己的`, reason: '自己做过一遍后，再看别人的做法才看得懂门道' },
  { name: '进阶拓展', goal: (t) => `知道${t}接下来往哪深入，形成自己的学习节奏`, reason: '基础打牢后再决定往哪个方向走，避免一开始就贪多' },
];

/* 把素材按原顺序切成连续的 n 段，尽量均分（前面的段先补 1 条）。
   切「连续段」而不是轮流分：检索结果本身是按相关性降序给的，
   拆散会把这个顺序打乱，把最相关的素材发到后面的课去。 */
function chunkEvenly(list, n) {
  const base = Math.floor(list.length / n);
  const extra = list.length % n;
  const chunks = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    chunks.push(list.slice(at, at + size));
    at += size;
  }
  return chunks;
}

/* 规则拼接课程：无 Key 或调用失败时的降级。产出与 LLM 版同结构。

   固定给满 6 节（素材不够的后几节没有文章，但有目标与理由），
   而不是把空课节筛掉：课程详情页是 6 张固定课卡的网格，
   少给几节会让卡片数量随素材多少忽多忽少。 */
function buildCourseFallback(theme, desc, sources) {
  const list = (sources || []).filter(s => s && s.title);
  const chunks = chunkEvenly(list, FALLBACK_LESSONS.length);

  const lessons = FALLBACK_LESSONS.map((tpl, i) => {
    return {
      name: tpl.name,
      goal: tpl.goal(theme),
      reason: tpl.reason,
      articles: chunks[i].map(s => ({
        title: String(s.title),
        url: String(s.url || ''),
        why: String(s.text || s.summary || '').trim().slice(0, 60) || '与本节课目标直接相关',
      })),
      actions: [],
    };
  });

  return {
    by: 'rules', // 供上层/测试判断这门课是否走了 LLM
    title: `${theme} 0→1 学习计划`,
    principle: desc || `由浅入深，把「${theme}」从零学起来。`,
    lessons,
    refs: list
      .filter(isCitable)
      .slice(0, 3)
      .map(s => ({ title: String(s.title), url: String(s.url) })),
  };
}

/* 归一化 URL 用于比对：忽略首尾空白与结尾斜杠 */
function normUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

/* 素材能否当「参考来源」展示给用户：得有链接，且链接得是长期有效的。
   durable === false 的是签名临时链接（见 server/zhihu.js isDurableUrl），
   它们照样能当课程的写作素材，只是不适合作为引用链接发给用户。 */
function isCitable(s) {
  return Boolean(s && s.url) && s.durable !== false;
}

/* 校验 LLM 输出：课节骨架 + 文章/参考来源的 URL 白名单。
   模型给的 URL 只要对得上素材，就换成素材原文的 title/url（顺带救回尾斜杠之类的差异）；
   对不上的说明是编造的，一律丢弃。 */
function sanitizeCourse(raw, theme, desc, sources) {
  // 可引用的素材：长期有效链接。签名临时链接（durable === false）只当写作素材
  const byUrl = new Map();
  for (const s of sources) {
    if (!isCitable(s)) continue;
    const key = normUrl(s.url);
    if (key) byUrl.set(key, { title: String(s.title), url: String(s.url) });
  }

  function pickArticle(a) {
    const hit = byUrl.get(normUrl(a && a.url));
    if (!hit) return null; // 编造的链接：整篇丢弃
    return { title: hit.title, url: hit.url, why: String((a && a.why) || '').trim().slice(0, 120) };
  }

  const lessons = (Array.isArray(raw && raw.lessons) ? raw.lessons : [])
    .map(ls => {
      const seen = new Set();
      const actions = (Array.isArray(ls && ls.actions) ? ls.actions : [])
        .map(a => String(a || '').trim())
        .filter(a => a && !seen.has(a) && seen.add(a))
        .slice(0, 5);
      return {
        name: String((ls && ls.name) || '').trim().slice(0, 20),
        goal: String((ls && ls.goal) || '').trim().slice(0, 120),
        reason: String((ls && ls.reason) || '').trim().slice(0, 200),
        articles: (Array.isArray(ls && ls.articles) ? ls.articles : []).map(pickArticle).filter(Boolean).slice(0, 3),
        actions,
      };
    })
    .filter(ls => ls.name && ls.goal)
    .slice(0, MAX_LESSONS);
  if (lessons.length === 0) throw new Error('LLM 返回的课程没有有效课节');

  const refs = (Array.isArray(raw && raw.refs) ? raw.refs : [])
    .map(r => byUrl.get(normUrl(r && r.url)))
    .filter(Boolean)
    .slice(0, 4);

  return {
    by: 'llm', // 供上层/测试判断这门课是否走了 LLM
    title: String((raw && raw.title) || `${theme} 0→1 学习计划`).slice(0, 40),
    principle: String((raw && raw.principle) || desc || '').slice(0, 200),
    lessons,
    refs: refs.length ? refs : buildCourseFallback(theme, desc, sources).refs,
  };
}

/* 课程入口：LLM 优先，未配置/失败/无素材则降级到规则课程 */
async function generateCourse(theme, desc, sources) {
  const list = (sources || []).filter(s => s && s.title);
  if (!isLLMConfigured() || list.length === 0) {
    return buildCourseFallback(theme, desc, list);
  }

  const prompt = `学习主题：${theme}\n主题说明：${desc || '（无）'}\n学习者画像：零基础入门\n\n` +
    `参考资料（共 ${list.length} 条）：\n\n${formatSources(list)}\n\n` +
    `请把以上资料组织成一门 0→1 的 6 节课课程，按 JSON 输出：` +
    `{"title":"XX 0→1 学习计划","principle":"一句话原则","lessons":[{"name":"课名","goal":"目标","reason":"为什么这节课排在这里","articles":[{"title":"资料标题","url":"资料链接","why":"选它的理由"}],"actions":["行动1","行动2"]}],"refs":[{"title":"资料标题","url":"资料链接"}]}`;

  try {
    const data = await chatJSON(COURSE_SYSTEM, prompt, { temperature: 0.4, maxTokens: 4000 });
    return sanitizeCourse(data, theme, desc, list);
  } catch (err) {
    // 降级到规则拼接（真实素材，不伪造内容）
    console.warn('[llm] 课程生成失败，降级为规则课程：', err.message);
    return buildCourseFallback(theme, desc, list);
  }
}

module.exports = {
  isLLMConfigured,
  clusterThemes,
  clusterByRules,
  generateCourse,
  buildCourseFallback,
  RECOMMENDED_EGGS,
};
