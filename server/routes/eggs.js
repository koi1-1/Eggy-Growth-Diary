'use strict';
/* ===== /api/eggs（Step 3 聚类生成 + Step 5.1 养成链路）=====
   读收藏 → 聚类成主题蛋 → 落库（此后以 DB 为准）
   金币 / 苹果 / 水滴 / 成长 的增减**全部在这里**按常量计算。

   安全：接口只接受「动作」（喂哪个、兑哪个、答对几题），
        不接受前端传入的金币数或成长值；每个 :id 先校验归属，不匹配一律 404。 */

const express = require('express');
const zhihu = require('../zhihu');
const llm = require('../llm');
const db = require('../db');

const router = express.Router();

/* ---------- 数值规则（唯一权威，改数值只改这里）---------- */
const COIN_PER_COURSE = 30;   // 学完一门系统课程
const COIN_PER_CORRECT = 10;  // 复习每答对 1 题
const PRICE = { apple: 10, water: 5 };       // 兑换价（金币）
const GROWTH_PER = { apple: 15, water: 10 }; // 喂养获得的成长值
const NEW_EGG = { coins: 50, apples: 1, water: 1 }; // 领养新手礼包
const MAX_GROWTH = 100;       // 成长值满则升级并归零
const QUIZ_LENGTH = 3;        // 复习题数上限，用于夹住客户端上报的答对数

const ITEM_NAME = { apple: '苹果', water: '水滴' };
/* 道具名 → 数据库列名。注意苹果的列是复数 apples，不能直接用 egg[type] */
const FIELD = { apple: 'apples', water: 'water' };

/* 下发给前端做文案展示，避免前端各复制一份数字后两边漂移。
   注意：这只是「展示用副本」，真正的计算永远用上面的常量。 */
function publicRules() {
  return {
    coinPerCourse: COIN_PER_COURSE,
    coinPerCorrect: COIN_PER_CORRECT,
    price: { ...PRICE },
    growthPer: { ...GROWTH_PER },
    maxGrowth: MAX_GROWTH,
    quizLength: QUIZ_LENGTH,
  };
}

/* ---------- 工具 ---------- */
function requireSession(req, res) {
  const s = req.session;
  if (!s || !s.uid) {
    res.status(401).json({ error: '未登录' });
    return null;
  }
  return s;
}

/* 取一颗属于当前用户的蛋。
   不存在、或者存在但属于别人，一律 404——不泄露「这个 id 是否存在」。 */
function loadOwnedEgg(req, res, session) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json({ error: '这个蛋不存在' });
    return null;
  }
  const row = db.getEggRow(id);
  if (!row || row.user_id !== session.uid) {
    res.status(404).json({ error: '这个蛋不存在' });
    return null;
  }
  return db.toPublicEgg(row);
}

/* ---------- 聚类（仅在 DB 里还没有这个用户的蛋、或显式 refresh 时执行）---------- */
async function buildEggs(session) {
  const { items, mock } = await zhihu.readCollections(session.accessToken);
  const eggs = await llm.clusterThemes(items);
  const source = items.length ? 'collections' : 'recommended';
  // 落库后返回 DB 里的蛋（含此前已领养、本次未再聚出的那些）
  const saved = db.saveEggs(session.uid, eggs, source);
  return { eggs: saved, source, mock };
}

async function getEggs(session, { force = false } = {}) {
  if (!force && db.hasEggs(session.uid)) {
    return { eggs: db.listEggs(session.uid), source: 'stored', mock: !zhihu.isUserApiConfigured() };
  }
  return buildEggs(session);
}

/* ---------- GET /api/eggs —— 我的蛋列表（含游戏状态）---------- */
router.get('/', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  try {
    const entry = await getEggs(session, { force: req.query.refresh === '1' });
    res.json({
      eggs: entry.eggs,
      meta: {
        source: entry.source,          // collections | recommended | stored
        mock: entry.mock,              // true = 用了假收藏（未配置凭证）
        llm: llm.isLLMConfigured(),    // false = 走了规则聚类
        rules: publicRules(),          // 前端展示用；数值权威仍在本文件常量
      },
    });
  } catch (err) {
    console.error('[eggs] 生成蛋失败：', err.message);
    res.status(502).json({ error: '暂时无法生成你的蛋，请稍后重试' });
  }
});

/* ---------- 课程素材 ---------- */

/* 从收藏里挑与主题相关的素材。收藏没有正文，title/summary 直接当素材正文用。
   先按主题命中排序；一条都命中不到时退回前几条（宁可素材泛一点，也不给空课程）。 */
function pickRelevant(items, theme, limit = 5) {
  const key = String(theme || '').toLowerCase();
  const grams = [];
  for (let i = 0; i < key.length - 1; i++) grams.push(key.slice(i, i + 2));

  const scored = items.map(it => {
    const text = `${it.title} ${it.summary}`.toLowerCase();
    let score = key && text.includes(key) ? 2 : 0;
    score += grams.filter(g => text.includes(g)).length;
    return { it, score };
  });

  const hit = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  const picked = (hit.length ? hit : scored).slice(0, limit).map(s => s.it);
  return picked.map(it => ({ title: it.title, url: it.url, text: it.summary }));
}

/* 课程缓存：内容可再生，不落库。key = uid:eggId
   知识库检索额度 500 次/天，同一颗蛋只生成一次 */
const courseCache = new Map();
const COURSE_CACHE_MAX = 200;

function cacheSet(key, value) {
  courseCache.set(key, value);
  // Map 保持插入顺序，超限就丢最早的一条
  while (courseCache.size > COURSE_CACHE_MAX) {
    courseCache.delete(courseCache.keys().next().value);
  }
}

/* ---------- GET /api/eggs/:id/course —— 该蛋的系统课程 ---------- */
router.get('/:id/course', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;

  const cacheKey = `${session.uid}:${egg.id}`;
  if (req.query.refresh !== '1') {
    const cached = courseCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });
  }

  try {
    // 素材优先级：知识库检索（有正文片段）> 用户自己的收藏（只有标题 + 摘要）
    let sources = [];
    let source = 'collections';
    let mock = false;

    let hits = null;
    try {
      hits = await zhihu.searchKnowledge(egg.theme);
    } catch (err) {
      // 检索失败不该让整门课挂掉，降级用收藏继续
      console.warn('[eggs] 知识库检索失败，降级用收藏做素材：', err.message);
    }

    if (hits && hits.length) {
      sources = hits;
      source = 'knowledge';
    } else {
      const read = await zhihu.readCollections(session.accessToken);
      mock = read.mock;
      sources = pickRelevant(read.items, egg.theme);
    }

    const course = await llm.generateCourse(egg.theme, egg.desc, sources);
    const payload = {
      course,
      meta: {
        source,                          // knowledge | collections
        mock,                            // true = 素材来自假收藏（未配置凭证）
        llm: course.by === 'llm',        // false = 走了规则拼接课程
        materialCount: sources.length,
      },
    };
    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('[eggs] 生成课程失败：', err.message);
    res.status(502).json({ error: '暂时无法生成这门课程，请稍后重试' });
  }
});

/* ---------- GET /api/eggs/:id —— 单颗蛋状态 ---------- */
router.get('/:id', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;
  res.json({ egg });
});

/* ---------- POST /api/eggs/:id/adopt —— 领养（幂等）---------- */
router.post('/:id/adopt', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;

  // 重复领养不重复发礼包，直接返回当前状态
  if (egg.adopted) return res.json({ egg, alreadyAdopted: true });

  egg.adopted = true;
  egg.coins = NEW_EGG.coins;
  egg.apples = NEW_EGG.apples;
  egg.water = NEW_EGG.water;
  res.json({ egg: db.saveState(egg) });
});

/* ---------- POST /api/eggs/:id/feed —— 喂养 {type: apple|water} ---------- */
router.post('/:id/feed', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;

  const type = req.body && req.body.type;
  if (!Object.prototype.hasOwnProperty.call(GROWTH_PER, type)) {
    return res.status(400).json({ error: '只能喂苹果或水滴' });
  }
  const field = FIELD[type];
  if (egg[field] <= 0) {
    return res.status(400).json({ error: `${ITEM_NAME[type]}不够啦，用金币兑换` });
  }

  egg[field] -= 1;
  egg.growth += GROWTH_PER[type];

  let leveledUp = false;
  if (egg.growth >= MAX_GROWTH) {
    egg.growth = 0;
    egg.level += 1;
    leveledUp = true;
  }

  res.json({
    egg: db.saveState(egg),
    gained: GROWTH_PER[type],
    leveledUp,
  });
});

/* ---------- POST /api/eggs/:id/exchange —— 金币兑换 {item: apple|water} ---------- */
router.post('/:id/exchange', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;

  const item = req.body && req.body.item;
  if (!Object.prototype.hasOwnProperty.call(PRICE, item)) {
    return res.status(400).json({ error: '只能兑换苹果或水滴' });
  }
  if (egg.coins < PRICE[item]) {
    return res.status(400).json({ error: '金币不够，去学课程赚金币' });
  }

  egg.coins -= PRICE[item];
  egg[FIELD[item]] += 1;
  res.json({ egg: db.saveState(egg), spent: PRICE[item] });
});

/* ---------- POST /api/eggs/:id/course-done —— 学完课程（一次性）---------- */
router.post('/:id/course-done', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;

  if (egg.courseDone) {
    return res.status(400).json({ error: '这门课已经学过了' });
  }
  egg.courseDone = true;
  egg.coins += COIN_PER_COURSE;
  res.json({ egg: db.saveState(egg), gained: COIN_PER_COURSE });
});

/* ---------- POST /api/eggs/:id/quiz —— 提交复习成绩 {correct} ---------- */
router.post('/:id/quiz', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;

  // 夹住客户端上报值，防止虚报答对数换金币
  const raw = Number(req.body && req.body.correct);
  const correct = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), QUIZ_LENGTH) : 0;

  const gained = correct * COIN_PER_CORRECT;
  egg.coins += gained;
  egg.quizCorrect = Math.max(egg.quizCorrect, correct); // 记最好成绩，不因重考退步
  res.json({ egg: db.saveState(egg), correct, gained });
});

module.exports = {
  router,
  getEggs,
  pickRelevant,
  COIN_PER_COURSE,
  COIN_PER_CORRECT,
  PRICE,
  GROWTH_PER,
  NEW_EGG,
  MAX_GROWTH,
  QUIZ_LENGTH,
  publicRules,
};
