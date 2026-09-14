'use strict';
/* ===== /api/eggs（Step 3 聚类生成 + Step 5.1 养成链路）=====
   读收藏 → 聚类成主题蛋 → 落库（此后以 DB 为准）
   金币 / 苹果 / 水滴 / 成长 的增减**全部在这里**按常量计算。

   安全：接口只接受「动作」（喂哪个、兑哪个、答对几题），
        不接受前端传入的金币数或成长值；每个 :id 先校验归属，不匹配一律 404。 */

const express = require('express');
const crypto = require('crypto');
const zhihu = require('../zhihu');
const llm = require('../llm');
const db = require('../db');

const router = express.Router();
const collectionKey = item => crypto.createHash('sha256').update(item.url || item.title).digest('hex');

/* ---------- 数值规则（唯一权威，改数值只改这里）---------- */
const COIN_PER_COURSE = 30;   // 学完一门系统课程
const COIN_PER_CORRECT = 10;  // 复习每答对 1 题
const PRICE = { apple: 10, water: 5 };       // 兑换价（金币）
const GROWTH_PER = { apple: 15, water: 10 }; // 喂养获得的成长值
const NEW_EGG = { coins: 50, apples: 1, water: 1 }; // 领养新手礼包
const MAX_GROWTH = 100;       // 成长值满则升级并归零
const QUIZ_LENGTH = 3;        // 复习题数上限，用于夹住客户端上报的答对数
const QUIZ_DAILY_MAX = QUIZ_LENGTH * COIN_PER_CORRECT;

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
  if (session.tokenExpiresAt && session.tokenExpiresAt <= Date.now()) {
    throw new Error('读取收藏失败：知乎授权已过期，请重新连接知乎');
  }
  const { items, mock } = await zhihu.readCollections(session.accessToken, { allowMock: session.mock === true });
  const result = await llm.clusterThemesWithMeta(items);
  const metadata = {
    version: 1,
    source: mock ? 'mock' : 'collections', mock,
    scope: 'recent_public', limit: 50,
    collectionCount: items.length,
    clusterMode: result.method, fallbackReason: result.reason,
    updatedAt: new Date().toISOString(),
    status: items.length ? 'ready' : 'empty',
    themes: result.eggs.map(({ theme, count, evidence, basis, indices }) => ({ theme, count, evidence, basis,
      memberKeys: indices.map(i => collectionKey(items[i])),
    })),
  };
  const saved = db.saveEggs(session.uid, result.eggs, metadata.source, metadata);
  return { eggs: saved, ...metadata, cached: false };
}

const pendingBuilds = new Map();
async function getEggs(session, { force = false } = {}) {
  if (pendingBuilds.has(session.uid)) return pendingBuilds.get(session.uid);
  if (!force) {
    const metadata = db.getCollectionSync(session.uid);
    if (metadata) return { eggs: db.listEggs(session.uid), ...metadata, cached: true };
    if (db.hasEggs(session.uid)) return { eggs: db.listEggs(session.uid), source: 'unknown', mock: null, clusterMode: 'unknown', cached: true, status: 'unverified', themes: [] };
  }
  const pending = buildEggs(session).finally(() => pendingBuilds.delete(session.uid));
  pendingBuilds.set(session.uid, pending);
  return pending;
}

/* ---------- GET /api/eggs —— 我的蛋列表（含游戏状态）---------- */
router.get('/', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  try {
    const entry = await getEggs(session, { force: req.query.refresh === '1' });
    const { eggs, ...metadata } = entry;
    res.set('Cache-Control', 'no-store');
    res.json({
      eggs: eggs.map(egg => {
        const theme = entry.themes?.find(t => t.theme === egg.theme);
        return { ...egg, evidence: theme?.evidence || [], basis: theme?.basis || 'historical', count: theme?.count || 0 };
      }),
      meta: {
        ...metadata,
        themes: undefined,
        llm: entry.clusterMode === 'llm',
        rules: publicRules(),          // 前端展示用；数值权威仍在本文件常量
      },
    });
  } catch (err) {
    const message = err.message.startsWith('读取收藏失败：') ? err.message : '暂时无法生成你的蛋，请稍后重试';
    res.status(502).json({ error: message });
  }
});

/* ---------- 课程素材 ---------- */

/* 旧数据只复用主题分组，不用无关收藏补齐素材。 */
function pickRelevant(items, theme, limit = 5) {
  const group = llm.clusterByRules(items).find(g => g.theme === theme);
  const picked = (group?.indices || []).slice(0, limit).map(i => items[i]);
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
  const sync = db.getCollectionSync(session.uid);
  const revision = sync?.updatedAt || 'legacy';
  if (req.query.refresh !== '1') {
    const cached = courseCache.get(cacheKey);
    if (cached?.revision === revision) return res.json({ ...cached, cached: true });
  }

  try {
    const collectionRead = await zhihu.readCollections(session.accessToken, { allowMock: session.mock === true });
    const group = sync?.themes?.find(t => t.theme === egg.theme);
    let sources;
    if (Array.isArray(group?.memberKeys)) {
      const keys = new Set(group.memberKeys);
      sources = collectionRead.items.filter(it => keys.has(collectionKey(it)))
        .map(it => ({ title: it.title, url: it.url, text: it.summary }));
    } else {
      sources = pickRelevant(collectionRead.items, egg.theme, 50);
      if (!sources.length && group?.evidence?.length) {
        const urls = new Set(group.evidence.map(e => e.url).filter(Boolean));
        sources = collectionRead.items.filter(it => urls.has(it.url))
          .map(it => ({ title: it.title, url: it.url, text: it.summary }));
      }
    }
    if (!sources.length) return res.status(422).json({ error: '近期收藏中没有这个主题对应的帖子，请重新读取收藏后再试。' });
    const course = await llm.generatePostSummaries(egg.theme, sources);
    const payload = {
      course,
      revision,
      meta: {
        source: 'collections',
        mock: collectionRead.mock,
        llm: course.by === 'llm',        // false = 走了规则拼接课程
        materialCount: sources.length,
        collectionCount: collectionRead ? collectionRead.items.length : 0,
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

/* 规则题是无 LLM 时的可靠兜底；题目内容仍来自当前课程的主题与目标。 */
function buildQuizQuestions(egg, course) {
  const lessons = Array.isArray(course && course.lessons) ? course.lessons : [];
  const goals = lessons.map(x => String(x.goal || '').trim()).filter(Boolean);
  const theme = egg.theme;
  return [
    { q: `学习「${theme}」时，第一步更适合做什么？`, options: ['先建立整体认知', '直接挑战最难案例', '只背结论不实践', '跳过基础'], answer: 0 },
    { q: `下面哪项最能检验自己真的学会了「${theme}」？`, options: ['只收藏文章', '完成一个小行动', '只看标题', '把计划放着不动'], answer: 1 },
    { q: `这门学习计划的节奏是怎样的？`, options: ['从易到难逐步实践', '所有内容同时开始', '只做最后一节', '只看不做'], answer: 0 },
  ].map((x, i) => ({ ...x, hint: goals[i] || goals[0] || `围绕${theme}完成一个可执行的小目标` }));
}

/* ---------- GET /api/eggs/:id/quiz —— 下发不含答案的试卷 ---------- */
router.get('/:id/quiz', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;
  const attemptId = String(req.query.attemptId || crypto.randomUUID());
  const existing = db.getQuizAttempt(attemptId, session.uid, egg.id);
  if (existing) {
    const questions = JSON.parse(existing.questions);
    return res.json({ attemptId, questions: questions.map(({ answer, ...q }) => q), settled: existing.settled_at ? { correct: existing.correct, gained: existing.gained } : null });
  }
  // 课程缓存不存在时仍能立刻出题；题目只使用蛋主题，不伪造知乎文章。
  const course = courseCache.get(`${session.uid}:${egg.id}`)?.course || null;
  const questions = buildQuizQuestions(egg, course);
  db.createQuizAttempt(attemptId, session.uid, egg.id, questions);
  res.json({ attemptId, questions: questions.map(({ answer, ...q }) => q), settled: null, source: 'rules' });
});

/* ---------- POST /api/eggs/:id/quiz —— 提交复习选项 {attemptId, answers} ---------- */
router.post('/:id/quiz', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const egg = loadOwnedEgg(req, res, session);
  if (!egg) return;

  const attemptId = String(req.body && req.body.attemptId || '');
  const answers = Array.isArray(req.body && req.body.answers) ? req.body.answers : [];
  let attempt = db.getQuizAttempt(attemptId, session.uid, egg.id);
  // 兼容旧版客户端：仅提交 correct 时按一次旧式结算，后续客户端必须提交选项。
  const legacyMode = !attempt && !attemptId && Number.isFinite(Number(req.body && req.body.correct));
  if (legacyMode) {
    const legacyId = crypto.randomUUID();
    const questions = buildQuizQuestions(egg, null);
    attempt = db.createQuizAttempt(legacyId, session.uid, egg.id, questions);
    const wanted = Math.min(Math.max(Math.trunc(Number(req.body.correct)), 0), QUIZ_LENGTH);
    answers.push(...questions.map((q, i) => i < wanted ? q.answer : (q.answer === 0 ? 1 : 0)));
  }
  if (!attempt) return res.status(400).json({ error: '试卷不存在或已过期，请重新开始复习' });
  if (attempt.settled_at) return res.json({ egg, attemptId, correct: attempt.correct, gained: attempt.gained, replay: true });
  let questions;
  try { questions = JSON.parse(attempt.questions); } catch { return res.status(400).json({ error: '试卷数据异常，请重新开始复习' }); }
  const normalized = questions.map((q, i) => Number.isInteger(Number(answers[i])) ? Number(answers[i]) : -1);
  const correct = normalized.reduce((n, a, i) => n + (a === questions[i].answer ? 1 : 0), 0);
  const previousBest = db.dailyQuizBest(session.uid, egg.id);
  const newlyRewarded = legacyMode ? correct : Math.max(0, correct - previousBest);
  const gained = newlyRewarded * COIN_PER_CORRECT;
  egg.coins += gained;
  egg.quizCorrect = Math.max(egg.quizCorrect, correct);
  const saved = db.saveState(egg);
  db.settleQuizAttempt(attemptId, session.uid, egg.id, normalized, correct, gained);
  res.json({ egg: saved, attemptId, correct, gained, newlyRewarded, dailyCap: QUIZ_DAILY_MAX });
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
  QUIZ_DAILY_MAX,
  publicRules,
};
