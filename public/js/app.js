/* ===== 蛋养学习 · 前端逻辑（Step 1：假数据） =====
   视觉规范：design/2.md（知乎风格设计规范） */

/* ---------- 假数据 ---------- */
const MOCK_USER = { name: "小夏", initial: "夏" };

/* size 决定气泡直径（lg/md/sm），tone 决定蛋的柔和配色（1–6） */
const MOCK_EGGS = [
  { id: 1, theme: "Python 编程", desc: "从入门到能写小工具", size: "lg", tone: 1 },
  { id: 2, theme: "心理学",      desc: "认知、情绪与自我成长", size: "md", tone: 2 },
  { id: 3, theme: "考研英语",    desc: "词汇、阅读与写作",    size: "md", tone: 3 },
  { id: 4, theme: "学习方法",    desc: "高效学习与专注",      size: "sm", tone: 4 },
  { id: 5, theme: "目标管理",    desc: "设定与达成目标",      size: "sm", tone: 5 },
  { id: 6, theme: "职场成长",    desc: "从校园到职场",        size: "sm", tone: 6 },
];

/* 纵向错落偏移，模拟 design/1.jpg 的散落排列（4px 网格） */
const BUBBLE_OFFSETS = [0, 20, -14, 16, -22, 4];

/* 离线兜底课程：只在后端不可达（直接打开 index.html）时展示。
   正常路径是 GET /api/eggs/:id/course —— 按蛋主题现生成的 6 节课课程。 */
const MOCK_COURSE = {
  title: "Python 编程 0→1 学习计划",
  principle: "先跑起来，再深入原理。",
  lessons: [
    {
      name: "认知建立",
      goal: "搞懂 Python 是什么、能用来做什么",
      reason: "先建立整体认知再动手，避免一上来就卡在语法细节里",
      articles: [
        { title: "Python 零基础入门，先搞懂这几个概念", url: "https://www.zhihu.com/p/1", why: "从零讲清变量、数据类型与循环" },
      ],
      actions: ["装上 Python 环境", "敲出第一个 print"],
    },
    {
      name: "基础梳理",
      goal: "理清变量、数据类型与循环之间的关系",
      reason: "概念混淆是最常见的卡点，先理顺再往下学",
      articles: [],
      actions: ["把这几类数据类型各写一个例子"],
    },
    {
      name: "方法入门",
      goal: "知道遇到问题该去哪查、怎么查",
      reason: "有了概念还要有方法，否则不知道下一步做什么",
      articles: [],
      actions: ["学会看官方文档", "用搜索解决一个报错"],
    },
    {
      name: "动手实践",
      goal: "用 Python 写一个能用的小工具",
      reason: "认知到位后必须动手，否则只停留在「看过」",
      articles: [
        { title: "用 Python 写一个自动整理文件的脚本", url: "https://www.zhihu.com/p/2", why: "用 os 和 shutil 半小时做出第一个实用工具" },
      ],
      actions: ["写一个自动整理文件的脚本"],
    },
    {
      name: "案例拆解",
      goal: "看懂别人写的脚本是怎么组织的",
      reason: "自己做过一遍后，再看别人的代码才看得懂门道",
      articles: [],
      actions: ["挑一个小项目通读一遍"],
    },
    {
      name: "进阶拓展",
      goal: "知道接下来往哪个方向深入",
      reason: "基础打牢后再决定方向，避免一开始就贪多",
      articles: [],
      actions: ["选一个方向继续学"],
    },
  ],
  refs: [
    { title: "如何找到合适的学习方法？", url: "https://www.zhihu.com/answer/126429643" },
    { title: "坐下来独立学习", url: "https://zhuanlan.zhihu.com/p/719999675" },
  ],
};

const MOCK_QUIZ = [
  { q: "Python 是哪一年发布的？", options: ["1989", "1991", "1995", "2000"], answer: 1 },
  { q: "Python 用什么表示代码块？", options: ["花括号 {}", "缩进", "分号 ;", "关键字 begin/end"], answer: 1 },
  { q: "下列哪个不是 Python 的内置数据类型？", options: ["int", "str", "list", "char"], answer: 3 },
];

/* ---------- 经济系统 ----------
   数值的权威在后端（server/routes/eggs.js）——前端发过去的只是「动作」，
   金币/成长值都以后端返回为准，前端改不动。这里这份只是**展示用副本**，
   页面加载时会被 /api/eggs 下发的 rules 覆盖，保证文案与后端一致；
   后端未启动（直接打开 index.html）时回退到下面这份默认值。 */
const DEFAULT_RULES = {
  coinPerCourse: 30,   // 学完一门系统课程
  coinPerCorrect: 10,  // 复习每答对 1 题
  price: { apple: 10, water: 5 },      // 兑换价（金币）
  growthPer: { apple: 15, water: 10 }, // 喂养获得的成长值
  maxGrowth: 100,      // 成长值满则升级并归零
  quizLength: 3,       // 复习题数，用于夹住上报的答对数
};
let RULES = DEFAULT_RULES;

function setRules(r) {
  if (!r || typeof r !== "object") return;
  RULES = {
    ...DEFAULT_RULES,
    ...r,
    price: { ...DEFAULT_RULES.price, ...(r.price || {}) },
    growthPer: { ...DEFAULT_RULES.growthPer, ...(r.growthPer || {}) },
  };
}

const ITEM_NAME = { apple: "苹果", water: "水滴" };

/* ---------- 状态 ---------- */
/* 每颗蛋的游戏状态由后端下发（server/db.js）。
   下面的兜底值只在后端不可用时生效（离线打开 index.html 的场景）。 */
function buildEggState(egg, i = 0) {
  return {
    id: egg.id != null ? egg.id : i + 1,
    theme: egg.theme,
    desc: egg.desc || "",
    size: egg.size || "md",
    tone: egg.tone || (i % 6) + 1,
    adopted: Boolean(egg.adopted),
    coins: Number.isFinite(egg.coins) ? egg.coins : 50,
    growth: Number.isFinite(egg.growth) ? egg.growth : 0,
    level: Number.isFinite(egg.level) ? egg.level : 1,
    apples: Number.isFinite(egg.apples) ? egg.apples : 1,
    water: Number.isFinite(egg.water) ? egg.water : 1,
    courseDone: Boolean(egg.courseDone),
    quizCorrect: Number(egg.quizCorrect) || 0,
    count: Number(egg.count) || 0,
    basis: egg.basis || 'historical',
    evidence: egg.evidence || [],
  };
}

const state = {
  currentEgg: null,
  eggs: [],
};

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* 统一的后端调用：带会话 Cookie；非 2xx 时抛出后端给的中文提示 */
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应，data 保持 null */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || "操作失败，请稍后重试");
    err.status = res.status;
    throw err;
  }
  return data;
}

/* 用后端返回的蛋覆盖本地副本 —— 后端是数值权威，前端不自己加减金币 */
function applyEgg(updated) {
  if (!updated) return null;
  const merged = buildEggState(updated);
  const i = state.eggs.findIndex((e) => e.id === merged.id);
  if (i >= 0) state.eggs[i] = merged;
  if (state.currentEgg && state.currentEgg.id === merged.id) state.currentEgg = merged;
  return merged;
}

function showView(id) {
  $$(".view").forEach(v => v.classList.remove("active"));
  const el = $(id);
  if (el) el.classList.add("active");
  window.scrollTo(0, 0);
}

/* 轻提示：全局 toast，2.4s 后自动消失 */
let toastTimer = null;
function flash(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ---------- 像素素材（纯内联 SVG 手作，不用任何外部图片）----------
   全部用「阶梯矩形」拼出像素轮廓：shape-rendering=crispEdges 关掉抗锯齿，
   颜色走 CSS 变量（--egg-fill / --egg-shade / --px-ink），换 tone 即换色。 */

/* 蛋轮廓：上尖下圆，逐个像素台阶走出来（viewBox 16×18） */
const EGG_PATH = "M6 0H10V1H12V2H13V3H14V4H15V14H14V15H12V16H10V17H6V16H4V15H2V14H1V4H2V3H3V2H4V1H6Z";

let eggSeq = 0;
/* 像素蛋：平涂主色 + 贴着右下轮廓的暗部 + 左上高光 + 深蓝描边。
   只有这四层，不再加斑点／纹理——16×18 的格子里多画一笔就糊成一个球。
   所有层都套 clipPath，超出的部分自动被蛋形裁掉，所以矩形可以放心画大。 */
function eggSVG(tone, level = 1) {
  const id = "dy-egg-clip-" + (++eggSeq);
  const fill = "var(--egg-fill, #6FB2FF)";
  const shade = "var(--egg-shade, #3D82D8)";
  const ink = "var(--px-ink, #26304A)";
  return `<svg viewBox="0 0 16 18" shape-rendering="crispEdges" role="img" aria-label="蛋">`
    + `<defs><clipPath id="${id}"><path d="${EGG_PATH}"/></clipPath></defs>`
    + `<g clip-path="url(#${id})">`
    + `<rect x="0" y="0" width="16" height="18" fill="${fill}"/>`
    // 暗部：右侧一条竖带 + 右下角一段台阶，拼出「光从左上来」的圆润感
    + `<rect x="13" y="5" width="3" height="10" fill="${shade}"/>`
    + `<rect x="10" y="15" width="6" height="3" fill="${shade}"/>`
    // 高光：左上两块阶梯白
    + `<rect x="5" y="3" width="3" height="2" fill="#FFFFFF" opacity=".9"/>`
    + `<rect x="3" y="5" width="3" height="4" fill="#FFFFFF" opacity=".9"/>`
    + `</g>`
    + (level >= 2 ? `<rect x="7" y="10" width="2" height="2" fill="${ink}" opacity=".8"/>` : '')
    + (level >= 3 ? `<rect x="4" y="12" width="2" height="2" fill="${ink}" opacity=".65"/><rect x="10" y="7" width="2" height="2" fill="${ink}" opacity=".65"/>` : '')
    + (level >= 4 ? `<path d="M5 1H11V2H5Z" fill="#FFD45C" stroke="${ink}" stroke-width=".5"/>` : '')
    + `<path d="${EGG_PATH}" fill="none" stroke="${ink}" stroke-width="1.6"/>`
    + `</svg>`;
}

/* 像素猫（开屏底部两只，参考 design/7.png） */
function catSVG(o) {
  const ink = "var(--px-ink, #26304A)";
  const pink = "var(--px-pink, #FFA8C0)";
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">`
    // 耳朵（含内耳）
    + `<rect x="2" y="1" width="3" height="3" fill="${o.fur}"/>`
    + `<rect x="11" y="1" width="3" height="3" fill="${o.fur}"/>`
    + `<rect x="3" y="2" width="1" height="1" fill="${pink}"/>`
    + `<rect x="12" y="2" width="1" height="1" fill="${pink}"/>`
    // 头 + 头顶斑纹
    + `<rect x="2" y="3" width="12" height="7" fill="${o.fur}"/>`
    + `<rect x="6" y="3" width="1" height="2" fill="${o.patch}"/>`
    + `<rect x="9" y="3" width="1" height="2" fill="${o.patch}"/>`
    // 眼睛 + 鼻子
    + `<rect x="5" y="6" width="2" height="2" fill="${ink}"/>`
    + `<rect x="9" y="6" width="2" height="2" fill="${ink}"/>`
    + `<rect x="7" y="8" width="2" height="1" fill="${pink}"/>`
    // 身体 + 肚皮 + 身侧斑纹
    + `<rect x="4" y="10" width="8" height="5" fill="${o.fur}"/>`
    + `<rect x="6" y="11" width="4" height="4" fill="${o.belly}"/>`
    + `<rect x="4" y="11" width="1" height="2" fill="${o.patch}"/>`
    + `<rect x="11" y="11" width="1" height="2" fill="${o.patch}"/>`
    // 尾巴
    + `<rect x="12" y="12" width="3" height="2" fill="${o.fur}"/>`
    + `</svg>`;
}

/* 主题 → 图标：命中关键词就用对应的，没命中按顺序轮一个中性图标 */
const THEME_ICONS = [
  [["python", "编程", "代码", "程序", "开发", "算法"], "💻"],
  // 不放「成长」这类泛词：会把「职场成长」之类误判到这一档
  [["心理", "情绪", "认知", "自我"], "🧠"],
  [["英语", "考研", "单词", "写作", "阅读"], "📚"],
  [["学习", "方法", "记忆", "专注", "笔记"], "📖"],
  [["目标", "管理", "时间", "计划", "效率"], "🎯"],
  [["职场", "工作", "求职", "实习", "面试"], "💼"],
  [["设计", "美术", "绘画", "摄影", "配色"], "🎨"],
  [["音乐", "乐器", "唱歌", "吉他"], "🎵"],
  [["运动", "健身", "篮球", "跑步", "健康"], "🏀"],
  [["游戏", "电竞", "主机"], "🎮"],
  [["科技", "数码", "人工智能", "ai"], "🤖"],
  [["动漫", "二次元", "漫画"], "🌍"],
  [["历史", "哲学", "人文", "社会"], "🏛️"],
  [["经济", "金融", "理财", "投资", "商业"], "📈"],
  [["生活", "美食", "旅行", "手工"], "🌱"],
];
const FALLBACK_ICONS = ["📖", "🧠", "🎯", "🌱", "🎵", "🎨", "🏀", "🤖"];

function themeIcon(theme, i) {
  const t = String(theme || "").toLowerCase();
  for (const [keys, icon] of THEME_ICONS) {
    if (keys.some(k => t.includes(k))) return icon;
  }
  return FALLBACK_ICONS[Math.abs(i) % FALLBACK_ICONS.length];
}

/* ---------- 视图 1：蛋气泡墙 ---------- */
function renderBubbleCloud() {
  const cloud = $("#bubble-cloud");
  cloud.innerHTML = "";
  state.eggs.forEach((egg, i) => {
    const b = document.createElement("button");
    b.type = "button";
    // egg-tone-N 提供 --egg-fill / --egg-shade，气泡与蛋共用同一套配色
    b.className = `bubble bubble--${egg.basis === 'title' ? 'lg' : egg.size} egg-tone-${egg.tone}`;
    b.style.setProperty("--offset", BUBBLE_OFFSETS[i % BUBBLE_OFFSETS.length] + "px");
    b.setAttribute("aria-label", `领养 ${egg.theme} 蛋`);
    // 图标是固定字符集、主题名转义后插入，无注入面
    b.innerHTML = `<span class="bubble-icon" aria-hidden="true">${themeIcon(egg.theme, i)}</span>`
      + `<span class="bubble-text">${esc(egg.theme)}</span>`
      + `<span class="bubble-count">${egg.basis === 'historical' ? '历史保留' : `${egg.count} 条收藏`}</span>`;
    b.title = egg.evidence[0]?.title || egg.theme;
    b.addEventListener("click", () => openAdopt(egg));
    cloud.appendChild(b);
  });
}

/* ---------- 视图 2：领养成功 ---------- */
function openAdopt(egg) {
  // 已领养过的蛋：点气泡直接回蛋主页，不再走一遍「领养成功」
  if (egg.adopted) return enterEgg(egg);

  const el = $("#adopt-egg");
  el.className = "adopt-egg egg-tone-" + egg.tone;
  el.innerHTML = eggSVG(egg.tone, egg.level);
  $("#adopt-theme").textContent = egg.theme;
  $("#adopt-desc").textContent = egg.desc + "，陪你一起成长";
  showView("#view-adopt");
  $("#btn-start-learn").onclick = (ev) => adopt(egg, ev.currentTarget);
}

function enterEgg(egg) {
  state.currentEgg = egg;
  showView("#view-egg");
  renderEggPage();
}

/* 领养：新手礼包（金币/苹果/水滴）由后端发放 */
async function adopt(egg, btn) {
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/eggs/${egg.id}/adopt`, { method: "POST" });
    enterEgg(applyEgg(data.egg));
    flash(`已领养「${egg.theme}」`);
  } catch (err) {
    if (err.status === 401) return autoLogin();
    if (err.status) return flash(err.message); // 后端明确拒绝 → 如实提示
    // 网络不可达（离线打开 index.html）→ 退回本地假数据，保持可玩
    egg.adopted = true;
    enterEgg(egg);
    flash(`已领养「${egg.theme}」`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------- 视图 3：蛋主页 ---------- */
function renderEggPage() {
  const egg = state.currentEgg;
  if (!egg) return;
  // 顶栏固定「我的宠物」，蛋主题名放在蛋上方的副标题里
  $("#egg-stage-theme").textContent = egg.theme;
  const stage = $("#stage-egg");
  stage.className = "stage-egg egg-tone-" + egg.tone;
  stage.innerHTML = eggSVG(egg.tone, egg.level);
  renderCourseEntryDesc(egg);
  renderEggStats(egg);
}

function renderEggStats(egg) {
  $("#egg-coins").textContent = egg.coins;
  $("#egg-level").textContent = "Lv." + egg.level;
  $("#count-apple").textContent = egg.apples;
  $("#count-water").textContent = egg.water;
  const pct = Math.min(100, (egg.growth / RULES.maxGrowth) * 100);
  $("#growth-fill").style.width = pct + "%";
  $("#growth-text").textContent = `成长值 ${egg.growth} / ${RULES.maxGrowth}`;
}

/* ---------- 喂养 ----------
   走接口：扣资源、加成长值、满级升级全部由后端算，前端只用返回值刷新界面 */
async function feed(type) {
  const egg = state.currentEgg;
  if (!egg) return;
  try {
    const data = await api(`/api/eggs/${egg.id}/feed`, { method: "POST", body: { type } });
    applyEgg(data.egg);
    renderEggStats(data.egg);
    flash(data.leveledUp
      ? `升级了！现在是 Lv.${data.egg.level}`
      : `${type === "apple" ? "喂了一颗苹果" : "喂了水"}，成长值 +${data.gained}`);
  } catch (err) {
    if (err.status === 401) return autoLogin();
    if (err.status) return flash(err.message); // 后端明确拒绝（如资源不足）→ 如实提示
    feedOffline(egg, type);                    // 网络不可达 → 本地兜底，保持可玩
  }
}

/* 后端不可用时的本地兜底（仅离线打开 index.html 的场景） */
function feedOffline(egg, type) {
  const key = type === "apple" ? "apples" : "water";
  if (egg[key] <= 0) return flash(`${ITEM_NAME[type]}不够啦，用金币兑换`);
  egg[key] -= 1;
  const gained = RULES.growthPer[type];
  egg.growth += gained;
  if (egg.growth >= RULES.maxGrowth) {
    egg.growth = 0;
    egg.level += 1;
    renderEggStats(egg);
    return flash(`升级了！现在是 Lv.${egg.level}`);
  }
  renderEggStats(egg);
  flash(`${type === "apple" ? "喂了一颗苹果" : "喂了水"}，成长值 +${gained}`);
}

function feedApple() { feed("apple"); }
function feedWater() { feed("water"); }

/* ---------- 金币兑换 ---------- */
function openExchange() {
  renderExchange();
  showView("#view-exchange");
}

function renderExchange() {
  const egg = state.currentEgg;
  if (!egg) return;
  $("#exchange-coins").textContent = egg.coins;
  $$(".exchange-item").forEach(btn => {
    btn.disabled = egg.coins < RULES.price[btn.dataset.item];
  });
}

async function exchange(item) {
  const egg = state.currentEgg;
  if (!egg) return;
  try {
    const data = await api(`/api/eggs/${egg.id}/exchange`, { method: "POST", body: { item } });
    applyEgg(data.egg);
    renderExchange();
    renderEggStats(data.egg);
    flash(`兑换成功！+1 ${ITEM_NAME[item]}`);
  } catch (err) {
    if (err.status === 401) return autoLogin();
    if (err.status) return flash(err.message); // 金币不足等 → 用后端文案
    const price = RULES.price[item];           // 网络不可达 → 本地兜底
    if (egg.coins < price) return flash("金币不够，去学课程赚金币");
    egg.coins -= price;
    if (item === "apple") egg.apples += 1; else egg.water += 1;
    renderExchange();
    renderEggStats(egg);
    flash(`兑换成功！+1 ${ITEM_NAME[item]}`);
  }
}

/* 换装：目前仅前端换配色，未做计费与持久化（后续版本再接后端） */
function dress() {
  const egg = state.currentEgg;
  egg.tone = (egg.tone % 6) + 1;
  const stage = $("#stage-egg");
  stage.className = "stage-egg egg-tone-" + egg.tone;
  stage.innerHTML = eggSVG(egg.tone, egg.level);
  flash("换了个新装扮");
}

/* ---------- 今天要做什么（4 个像素气泡）----------
   课程 / 复习是直达入口；徽章 / 探索就地展开占位面板，再点一次收起 */
function togglePanel(name) {
  const map = { badge: "#panel-badge", explore: "#panel-explore" };
  const target = map[name];
  if (!target) return;
  const opening = $(target).classList.contains("hidden");
  Object.values(map).forEach(sel => $(sel).classList.add("hidden"));
  if (opening) $(target).classList.remove("hidden");
}

/* ---------- 视图 4：课程详情 ----------
   课程内容来自后端（LLM 整理 + 知乎知识库/收藏素材），属于外部文本，
   渲染一律转义，避免素材里混入标签被当成 HTML 执行。 */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* 参考来源的链接只认 http(s)，挡掉 javascript: 之类的伪协议 */
function safeUrl(u) {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/* 已取回的课程按蛋缓存，重复打开不再请求（后端也有缓存，这里再挡一层） */
const courseCache = new Map();

function renderCourseEntryDesc(egg) {
  const cached = egg && courseCache.get(egg.id);
  const n = cached && cached.course && cached.course.lessons && cached.course.lessons.length;
  // 气泡上的副标题位置窄，文案从简：节数 + 学完能拿多少金币
  $("#course-entry-desc").textContent = `${n ? `${n} 篇帖子总结` : '收藏帖子总结'} · 学完 +${RULES.coinPerCourse} 金币`;
}

const REFS_TITLE = {
  knowledge: "参考来源 · 来自知乎知识库",
  collections: "参考来源 · 来自你的收藏",
};

/* 行动任务的勾选状态：只存在本机（localStorage），上传后端留到复习/进度功能时再做 */
const TASK_KEY = "dy-tasks";

function loadTasks() {
  try { return JSON.parse(localStorage.getItem(TASK_KEY) || "{}") || {}; } catch { return {}; }
}

function taskKey(eggId, si, ti) { return `${eggId}:${si}:${ti}`; }

function toggleTask(eggId, si, ti, done) {
  const all = loadTasks();
  const k = taskKey(eggId, si, ti);
  if (done) all[k] = 1; else delete all[k];
  try { localStorage.setItem(TASK_KEY, JSON.stringify(all)); } catch { /* 隐私模式等写入失败：忽略，不影响阅读 */ }
}

/* 课程总览：标题 + 一句话原则 + 6 张课卡（bento 网格）+ 参考来源。
   第 1、4 张卡整行（--lg），其余半宽，对应 design/5.png 的排法。 */
function renderCourse(course, meta) {
  const doc = $("#course-doc");
  const c = course || MOCK_COURSE;
  if (!c || !Array.isArray(c.lessons)) return renderCourseHint("课程内容为空，稍后再试试。");
  if (c.format === 'post-summaries') {
    let html = `<h1>${esc(c.title)}</h1><p class="course-note">${c.lessons.length} 篇${meta?.mock ? '示例' : '收藏'} · 根据知乎返回的摘要整理，未读取帖子全文。</p>`;
    for (const post of c.lessons) {
      html += `<section class="post-summary"><h2>${esc(post.name)}${post.refNumber ? ` <sup>[${post.refNumber}]</sup>` : ''}</h2>`;
      html += `<p class="course-note">${post.summaryMode === 'ai' ? '摘要总结' : post.summaryMode === 'provided' ? '知乎提供的原摘要 · AI 总结暂不可用' : '该帖暂未返回摘要，暂无可总结内容。'}</p>`;
      for (const paragraph of post.paragraphs || []) html += `<p>${esc(paragraph)}</p>`;
      html += '</section>';
    }
    html += '<div class="refs"><h2>参考来源</h2><ol>';
    for (const ref of c.refs || []) {
      const url = safeUrl(ref.url);
      if (url) html += `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(ref.title)}</a></li>`;
    }
    html += '</ol></div>';
    doc.innerHTML = html;
    return;
  }

  let html = `<h1>${esc(c.title)}</h1>`;
  if (c.principle) html += `<p class="course-principle">排课原则：${esc(c.principle)}</p>`;
  if (c.by === "rules") {
    html += `<p class="course-note">这门课由资料自动拼接而成（AI 整理暂不可用），文章均取自下列来源。</p>`;
  }

  html += `<div class="lesson-grid">`;
  c.lessons.forEach((ls, li) => {
    const large = li === 0 || li === 3 ? " lesson-card--lg" : "";
    html += `<button type="button" class="lesson-card${large}" data-lesson="${li}">`
      + `<span class="lesson-card__top"><span class="lesson-card__idx">Lesson${li + 1}</span>`
      + `<span class="lesson-card__icon" aria-hidden="true">📖</span></span>`
      + `<span class="lesson-card__name">${esc(ls.name)}</span>`
      + `<span class="lesson-card__goal">${esc(ls.goal)}</span>`
      + `</button>`;
  });
  html += `</div>`;

  const refs = (c.refs || []).filter(r => safeUrl(r.url));
  html += `<div class="refs"><h3>${esc((meta && REFS_TITLE[meta.source]) || "参考来源")}</h3>`;
  if (refs.length) {
    refs.forEach(r => {
      html += `<a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">${esc(r.title)}</a>`;
    });
  } else {
    // 知识库里的 PDF/EPUB 文档给的是签名临时链接，过一会儿就失效，不作为参考来源展示
    html += `<p class="course-note">本课素材来自知识库文档，暂无长期有效的原文链接。</p>`;
  }
  html += `</div>`;
  doc.innerHTML = html;

  doc.querySelectorAll(".lesson-card").forEach(card => {
    card.addEventListener("click", () => openLesson(Number(card.dataset.lesson)));
  });
}

function renderCourseHint(text) {
  $("#course-doc").innerHTML = `<p class="course-note">${esc(text)}</p>`;
}

/* ---------- 单节课详情 ---------- */
let currentLesson = 0;

/* 取当前蛋已生成的课程；没有则回退示例课程（离线场景） */
function currentCourse() {
  const cached = state.currentEgg && courseCache.get(state.currentEgg.id);
  return (cached && cached.course) || MOCK_COURSE;
}

function openLesson(i) {
  const lessons = currentCourse().lessons || [];
  if (!lessons[i]) return;
  currentLesson = i;
  renderLesson(i);
  showView("#view-lesson");
}

/* 一节的内容 = 目标 + 为什么排这里 + 学习文章（带「为什么选它」）+ 行动任务 */
function renderLesson(i) {
  const lessons = currentCourse().lessons || [];
  const ls = lessons[i];
  const doc = $("#lesson-doc");
  if (!ls) return;

  const eggId = (state.currentEgg && state.currentEgg.id) || 0;
  const done = loadTasks();

  $("#lesson-topbar-title").textContent = `第 ${i + 1} 课 · ${ls.name}`;

  let html = `<h1>${esc(ls.name)}</h1>`;
  html += `<p class="stage-goal"><strong>目标：</strong>${esc(ls.goal)}</p>`;
  if (ls.reason) html += `<p class="stage-why">为什么排在这里：${esc(ls.reason)}</p>`;

  const arts = (ls.articles || []).filter(a => safeUrl(a.url));
  if (arts.length) {
    html += `<div class="stage-articles"><h3>学习文章</h3><ol>`;
    arts.forEach(a => {
      html += `<li><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.title)}</a>`;
      if (a.why) html += `<span class="art-why">选它：${esc(a.why)}</span>`;
      html += `</li>`;
    });
    html += `</ol></div>`;
  }

  if ((ls.actions || []).length) {
    html += `<div class="stage-actions"><h3>行动任务</h3>`;
    ls.actions.forEach((a, ti) => {
      const k = taskKey(eggId, i, ti);
      html += `<label class="task"><input type="checkbox" data-task="${esc(k)}"${done[k] ? " checked" : ""}>`
        + `<span>${esc(a)}</span></label>`;
    });
    html += `</div>`;
  }
  doc.innerHTML = html;

  // 勾选后立即落盘（每次渲染后重新绑定，避免绑到已被替换掉的旧节点）
  doc.querySelectorAll("input[data-task]").forEach(box => {
    box.addEventListener("change", () => {
      const [id, li, ti] = box.dataset.task.split(":");
      toggleTask(id, li, ti, box.checked);
    });
  });

  $("#btn-lesson-prev").disabled = i === 0;
  $("#btn-lesson-next").disabled = i >= lessons.length - 1;
}

async function openCourse(refresh = false) {
  const egg = state.currentEgg;
  if (!egg) return;
  showView("#view-course");

  const cached = courseCache.get(egg.id);
  if (!refresh && cached) return renderCourse(cached.course, cached.meta);

  renderCourseHint(`正在整理「${egg.theme}」的课程…`);
  try {
    const data = await api(`/api/eggs/${egg.id}/course${refresh ? '?refresh=1' : ''}`);
    courseCache.set(egg.id, data);
    if (state.currentEgg?.id !== egg.id || !$('#view-course').classList.contains('active')) return;
    renderCourse(data.course, data.meta);
    renderCourseEntryDesc(egg);
  } catch (err) {
    if (err.status === 401) return autoLogin();
    if (err.status) return renderCourseHint(err.message); // 后端明确拒绝 → 如实说明
    renderCourseHint('暂时无法读取收藏总结，请稍后重试。');
  }
}

/* ---------- 视图 5：复习测验 ---------- */
function renderQuiz(questions = MOCK_QUIZ) {
  const body = $("#quiz-body");
  body.innerHTML = "";
  questions.forEach((item, qi) => {
    const div = document.createElement("div");
    div.className = "quiz-q";
    div.innerHTML = `<h3><span class="qnum">Q${qi + 1}.</span>${item.q}</h3>`;
    item.options.forEach((opt, oi) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiz-opt";
      b.textContent = String.fromCharCode(65 + oi) + ". " + opt;
      b.dataset.opt = oi;
      b.addEventListener("click", () => pickAnswer(b, item, qi));
      div.appendChild(b);
    });
    body.appendChild(div);
  });
  const score = document.createElement("div");
  score.className = "quiz-score";
  score.id = "quiz-score";
  score.textContent = `答完自动计分，每答对 1 题得 ${RULES.coinPerCorrect} 金币`;
  body.appendChild(score);
}

const quizState = { answered: new Set(), answers: [], correct: 0, attemptId: null, settled: false, total: 0 };

function pickAnswer(btn, item, qi) {
  if (quizState.answered.has(qi)) return;
  quizState.answered.add(qi);
  const opts = btn.parentElement.querySelectorAll(".quiz-opt");
  const correct = item.answer;
  const picked = parseInt(btn.dataset.opt, 10);
  quizState.answers[qi] = picked;
  opts.forEach((b, oi) => {
    b.disabled = true;
    if (oi === correct) b.classList.add("correct");
  });
  if (picked === correct) quizState.correct += 1;
  else btn.classList.add("wrong");
  updateQuizScore();
}

function updateQuizScore() {
  const el = $("#quiz-score");
  const done = quizState.answered.size;
  const total = quizState.total || MOCK_QUIZ.length;
  if (done < total) {
    el.textContent = `已答 ${done} / ${total}，答对 ${quizState.correct} 题`;
    return;
  }
  el.textContent = `答对 ${quizState.correct} / ${total} 题，结算中…`;
  submitQuiz(el);
}

/* 复习收益由后端结算（后端会夹住上报的答对数，防止前端虚报刷金币） */
async function submitQuiz(el) {
  const egg = state.currentEgg;
  if (!egg) return;
  try {
    const data = await api(`/api/eggs/${egg.id}/quiz`, {
      method: "POST",
      body: { attemptId: quizState.attemptId, answers: quizState.answers },
    });
    applyEgg(data.egg);
    renderEggStats(data.egg);
    el.innerHTML = `答对 <b>${data.correct}</b> / ${quizState.total} 题，+${data.gained} 金币`;
  } catch (err) {
    if (err.status === 401) return autoLogin();
    if (err.status) { el.textContent = err.message; return; } // 用 textContent，不解析 HTML
    const gained = quizState.correct * RULES.coinPerCorrect;  // 网络不可达 → 本地兜底
    egg.coins += gained;
    renderEggStats(egg);
    el.innerHTML = `答对 <b>${quizState.correct}</b> / ${MOCK_QUIZ.length} 题，+${gained} 金币`;
  }
}

function openQuiz() {
  quizState.answered = new Set();
  quizState.answers = [];
  quizState.correct = 0;
  quizState.attemptId = null;
  quizState.settled = false;
  quizState.total = 0;
  showView("#view-quiz");
  const body = $("#quiz-body");
  body.innerHTML = `<div class="quiz-score">正在准备与你的课程对应的复习题…</div>`;
  api(`/api/eggs/${state.currentEgg.id}/quiz`).then(data => {
    quizState.attemptId = data.attemptId;
    quizState.total = data.questions.length;
    renderQuiz(data.questions);
  }).catch(err => {
    if (err.status === 401) return autoLogin();
    renderQuiz(MOCK_QUIZ);
    flash("暂时无法连接，展示离线复习题");
  });
}

/* ---------- 课程完成 ---------- */
async function courseDone() {
  const egg = state.currentEgg;
  if (!egg) return;

  let msg;
  try {
    const data = await api(`/api/eggs/${egg.id}/course-done`, { method: "POST" });
    applyEgg(data.egg);
    msg = `课程完成！+${data.gained} 金币`;
  } catch (err) {
    if (err.status === 401) return autoLogin();
    if (err.status) {
      msg = err.message;            // 例如「这门课已经学过了」，由后端判定
    } else if (egg.courseDone) {
      msg = "这门课已经学过了";      // 网络不可达 → 本地兜底
    } else {
      egg.courseDone = true;
      egg.coins += RULES.coinPerCourse;
      msg = `课程完成！+${RULES.coinPerCourse} 金币`;
    }
  }
  showView("#view-egg");
  renderEggPage();
  flash(msg);
}

/* ---------- 返回导航 ---------- */
function goBack(target) {
  if (target === "egg") { showView("#view-egg"); renderEggPage(); }
  else if (target === "wall") { showView("#view-wall"); }
  // 单节课 → 回课程总览（网格已在 DOM 里，不用重渲染）
  else if (target === "course") { showView("#view-course"); }
}

/* ---------- 事件绑定 ----------
   像素风改版后，「课程 / 复习 / 徽章 / 探索」都是 <button>，天然可键盘访问，
   原先给 div 加 role=button 的 onActivate 帮手已不再需要。 */
function bindEvents() {
  $("#btn-feed-apple").addEventListener("click", feedApple);
  $("#btn-feed-water").addEventListener("click", feedWater);
  $("#btn-dress").addEventListener("click", dress);
  $("#btn-exchange").addEventListener("click", openExchange);
  $("#btn-exchange-close").addEventListener("click", () => {
    showView("#view-egg");
    renderEggPage();
  });
  $$(".exchange-item").forEach(b => b.addEventListener("click", () => exchange(b.dataset.item)));
  $("#btn-enter").addEventListener("click", enterFromSplash);
  $("#btn-refresh-eggs").addEventListener("click", refreshEggs);
  $("#btn-todo-course").addEventListener("click", () => openCourse());
  $('#btn-refresh-course').addEventListener('click', () => openCourse(true));
  $("#btn-todo-review").addEventListener("click", openQuiz);
  $("#btn-todo-badge").addEventListener("click", () => togglePanel("badge"));
  $("#btn-todo-explore").addEventListener("click", () => togglePanel("explore"));
  $("#btn-course-done").addEventListener("click", courseDone);
  $("#btn-lesson-prev").addEventListener("click", () => openLesson(currentLesson - 1));
  $("#btn-lesson-next").addEventListener("click", () => openLesson(currentLesson + 1));
  $$(".back-btn").forEach(b => b.addEventListener("click", () => goBack(b.dataset.back)));

  // 退出（登录为静默自动，不设按钮）
  $("#btn-logout").addEventListener("click", async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    window.location.reload();
  });
}

/* ---------- 蛋墙数据（Step 3）---------- */
function setEggs(list) {
  state.eggs = list.map(buildEggState);
  renderBubbleCloud();
  const evidence = $('#wall-evidence');
  evidence.hidden = !list.length;
  $('#wall-evidence-list').innerHTML = state.eggs.map(egg => {
    const sample = egg.evidence[0];
    const url = sample && safeUrl(sample.url);
    const source = sample ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(sample.title)}</a>` : esc(sample.title)) : '历史主题，尚无本次收藏依据';
    return `<li><strong>${esc(egg.theme)}</strong> · ${egg.count} 条${egg.basis === 'title' ? ' · 按标题展示' : ''}<br>${source}</li>`;
  }).join('');
}

/* 说明数据来源，不把示例数据说成用户的真实收藏 */
function updateWallSub(meta) {
  const el = document.querySelector(".wall-sub");
  if (!el || !meta) return;
  if (meta.source === "logged-out") {
    el.textContent = "当前浏览器尚未连接知乎";
    $('#wall-connect').classList.remove('hidden');
  } else if (meta.source === 'unknown') {
    el.textContent = '旧版缓存，收藏来源尚未核验';
  } else {
    const n = Number.isInteger(meta.collectionCount) ? meta.collectionCount : 0;
    const mode = meta.clusterMode === 'none' ? '未生成新主题' : meta.clusterMode === 'llm' ? 'AI 聚类' : '标题规则分组';
    const time = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    el.textContent = `${meta.mock ? '示例收藏' : '知乎公开范围近期收藏'} ${n} 条 · ${mode} · ${meta.cached ? '上次结果' : '本次更新'} ${time}`
      + (meta.mock ? '' : '。最多读取 50 条，不包含完整收藏历史。')
      + (meta.fallbackReason === 'llm_failed' ? ' AI 暂不可用，已使用标题规则。' : '')
      + (meta.status === 'empty' ? ' 接口本次返回空列表，已领养的蛋继续保留。' : '');
  }
}

let wallLoading = false;
async function fetchWall(refresh) {
  if (wallLoading) return;
  wallLoading = true;
  const btn = $('#btn-refresh-eggs');
  const status = $('#wall-status');
  btn.disabled = true;
  btn.textContent = '正在读取收藏…';
  status.textContent = '';
  try {
    const data = await api(refresh ? '/api/eggs?refresh=1' : '/api/eggs');
    if (!Array.isArray(data?.eggs) || !data.meta) throw new Error('收藏响应格式异常');
    setRules(data.meta.rules);
    setEggs(data.eggs);
    courseCache.clear();
    updateWallSub(data.meta);
    $('#wall-connect').classList.add('hidden');
    if (refresh) status.textContent = data.meta.mock ? '已更新示例数据' : `本次读取 ${data.meta.collectionCount} 条近期收藏，生成 ${data.eggs.filter(e => e.basis !== 'historical').length} 个气泡。`;
  } catch (err) {
    if (err.status === 401) {
      setEggs([]);
      updateWallSub({ source: 'logged-out' });
    } else {
      status.textContent = `更新失败：${err.message}。${state.eggs.length ? '下方仍为上次结果，本次未更新。' : '未生成兴趣气泡。'}`;
      $('#wall-connect').classList.remove('hidden');
    }
  } finally {
    wallLoading = false;
    btn.disabled = false;
    btn.textContent = '↻ 重新读取收藏';
  }
}

async function loadEggs() {
  return fetchWall(false);
}

async function refreshEggs() {
  return fetchWall(true);
}

/* ---------- 开屏：EARTH ONLINE（design/7.png）----------
   首屏就是开屏（避免白屏）；已看过则直接进蛋墙。
   只做单页，「1/6」是装饰，不实现多页轮播。 */
const SPLASH_FLAG = "dy-splash-done";

function enterFromSplash() {
  sessionSet(SPLASH_FLAG, "1");
  showView("#view-wall");
}

function initSplash() {
  $("#splash-cats").innerHTML =
    catSVG({ fur: "#E8A34A", patch: "#B87724", belly: "#FBE7C6" })
    + catSVG({ fur: "#8C93A8", patch: "#5C6377", belly: "#DDE1EA" });
  if (sessionGet(SPLASH_FLAG)) showView("#view-wall");
}

/* ---------- 登录态（Step 2）---------- */
/* 产品嵌在知乎内，用户本就已登录 —— 界面不展示登录按钮，
   未登录时静默走一次授权；同一标签页只自动尝试一次，避免失败时反复跳转 */
const AUTO_LOGIN_FLAG = "dy-auto-login-tried";

function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* 隐私模式等场景忽略 */ } }

function autoLogin() {
  if (sessionGet(AUTO_LOGIN_FLAG)) { renderUser(null); return; }
  sessionSet(AUTO_LOGIN_FLAG, "1");
  window.location.href = "/api/auth/login";
}

/* user 为 null 表示未登录；用 DOM API 赋值，不用 innerHTML（防止远程字段注入） */
function renderUser(user) {
  const loggedIn = Boolean(user);
  const $avatar = $("#user-avatar");
  const $name = $("#user-name");

  $avatar.classList.toggle("hidden", !loggedIn);
  $name.classList.toggle("hidden", !loggedIn);
  $("#btn-logout").classList.toggle("hidden", !loggedIn);

  if (!loggedIn) return;
  $name.textContent = user.name || "知乎用户";
  $avatar.textContent = "";
  if (user.avatar) {
    const img = document.createElement("img");
    img.src = user.avatar;
    img.alt = "";
    $avatar.appendChild(img);
  } else {
    $avatar.textContent = (user.name || "知").charAt(0);
  }
}

async function loadUser() {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (res.status === 401) { autoLogin(); return; }
    if (!res.ok) throw new Error("bad status");
    renderUser(await res.json());
  } catch {
    // 后端未启动（例如直接打开 index.html）→ 沿用假数据，保持 Step 1 体验
    renderUser(null);
  }
}

/* ---------- 初始化 ---------- */
function init() {
  initSplash();        // 开屏（已看过则直接进蛋墙）
  renderBubbleCloud();
  bindEvents();
  loadUser();
  loadEggs();
}

document.addEventListener("DOMContentLoaded", init);
