'use strict';
/* ===== SQLite 数据层（Step 5.1）=====
   用 Node 内置的 node:sqlite，零原生依赖、零编译（Node ≥ 22.5）。
   存一颗蛋的「定义 + 养成进度」：金币 / 苹果 / 水滴 / 成长 / 等级 / 课程与复习进度。

   设计要点：
   - 聚类只写「主题元信息」（desc/size/tone/count），**绝不碰游戏状态列**，
     所以重新聚类不会重置玩家进度
   - 一颗蛋的游戏状态只由 server/routes/eggs.js 按常量计算后写入，前端无法直接改 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

/* 游戏状态列：重新聚类时必须原样保留 */
const STATE_COLUMNS = [
  'adopted', 'coins', 'apples', 'water', 'growth', 'level',
  'course_done', 'quiz_correct',
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS eggs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT    NOT NULL,
  theme         TEXT    NOT NULL,
  desc          TEXT    NOT NULL DEFAULT '',
  size          TEXT    NOT NULL DEFAULT 'md',
  tone          INTEGER NOT NULL DEFAULT 1,
  count         INTEGER NOT NULL DEFAULT 0,
  source        TEXT    NOT NULL DEFAULT 'collections',
  adopted       INTEGER NOT NULL DEFAULT 0,
  coins         INTEGER NOT NULL DEFAULT 0,
  apples        INTEGER NOT NULL DEFAULT 0,
  water         INTEGER NOT NULL DEFAULT 0,
  growth        INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,
  course_done   INTEGER NOT NULL DEFAULT 0,
  quiz_correct  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, theme)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  egg_id INTEGER NOT NULL,
  questions TEXT NOT NULL,
  answers TEXT,
  correct INTEGER,
  gained INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quiz_user_egg ON quiz_attempts(user_id, egg_id, created_at);
CREATE TABLE IF NOT EXISTS collection_syncs (
  user_id TEXT PRIMARY KEY,
  metadata TEXT NOT NULL
);
`;

/* DB 行 → 前端可见的蛋对象。keywords 等中间产物不外露。 */
function toPublicEgg(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    theme: row.theme,
    desc: row.desc,
    size: row.size,
    tone: Number(row.tone),
    count: Number(row.count),
    source: row.source,
    adopted: row.adopted === 1,
    coins: Number(row.coins),
    apples: Number(row.apples),
    water: Number(row.water),
    growth: Number(row.growth),
    level: Number(row.level),
    courseDone: row.course_done === 1,
    quizCorrect: Number(row.quiz_correct),
  };
}

/* ---------- Store 工厂 ----------
   传 ':memory:' 可得到一次性内存库（测试用） */
function createStore(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const stmt = {
    listByUser: db.prepare('SELECT * FROM eggs WHERE user_id = ? ORDER BY id'),
    getById: db.prepare('SELECT * FROM eggs WHERE id = ?'),
    getByTheme: db.prepare('SELECT * FROM eggs WHERE user_id = ? AND theme = ?'),
    getSync: db.prepare('SELECT metadata FROM collection_syncs WHERE user_id = ?'),
    saveSync: db.prepare('INSERT INTO collection_syncs (user_id, metadata) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET metadata=excluded.metadata'),
    insertOne: db.prepare(
      `INSERT INTO eggs (user_id, theme, desc, size, tone, count, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    // 只覆盖主题元信息；游戏状态列不在 SET 里，重新聚类不会冲掉进度
    upsertMeta: db.prepare(
      `INSERT INTO eggs (user_id, theme, desc, size, tone, count, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, theme) DO UPDATE SET
         desc       = excluded.desc,
         size       = excluded.size,
         tone       = excluded.tone,
         count      = excluded.count,
         source     = excluded.source,
         updated_at = datetime('now')`
    ),
    deleteById: db.prepare('DELETE FROM eggs WHERE id = ?'),
    updateState: db.prepare(
      `UPDATE eggs SET coins = ?, apples = ?, water = ?, growth = ?, level = ?,
                       course_done = ?, quiz_correct = ?, adopted = ?,
                       updated_at = datetime('now')
       WHERE id = ?`
    ),
    getAttempt: db.prepare('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ? AND egg_id = ?'),
    insertAttempt: db.prepare('INSERT INTO quiz_attempts (id,user_id,egg_id,questions,created_at) VALUES (?,?,?,?,datetime(\'now\'))'),
    settleAttempt: db.prepare('UPDATE quiz_attempts SET answers=?, correct=?, gained=?, settled_at=datetime(\'now\') WHERE id=? AND user_id=? AND egg_id=?'),
    dailyBest: db.prepare("SELECT COALESCE(MAX(correct), 0) AS best FROM quiz_attempts WHERE user_id=? AND egg_id=? AND settled_at IS NOT NULL AND date(created_at, '+8 hours') = date('now','+8 hours')"),
  };

  /* 聚类结果落库；返回该用户当前的**全部**蛋（含此前已领养、本次未再聚出的） */
  function saveEggs(userId, eggs, source, metadata = null) {
    db.exec('BEGIN IMMEDIATE');
    try {
    const keptIds = [];
    for (const e of eggs) {
      stmt.upsertMeta.run(
        userId, e.theme, e.desc || '', e.size || 'md',
        Number(e.tone) || 1, Number(e.count) || 0, source
      );
      const row = stmt.getByTheme.get(userId, e.theme);
      if (row) keptIds.push(Number(row.id));
    }

    // 清掉本次没再聚出、且尚未领养的旧主题，避免蛋墙越刷越多。
    // 已领养的蛋一律保留——玩家的养成进度不能因为一次重新聚类就消失。
    for (const row of stmt.listByUser.all(userId)) {
      if (row.adopted === 0 && !keptIds.includes(Number(row.id))) {
        stmt.deleteById.run(row.id);
      }
    }

    if (metadata) stmt.saveSync.run(userId, JSON.stringify(metadata));
    const saved = stmt.listByUser.all(userId).map(toPublicEgg);
    db.exec('COMMIT');
    return saved;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    db,
    listEggs: (userId) => stmt.listByUser.all(userId).map(toPublicEgg),
    getEgg: (id) => toPublicEgg(stmt.getById.get(Number(id))),
    /* 原始行，供路由做归属校验（含 user_id，不外发给前端） */
    getEggRow: (id) => stmt.getById.get(Number(id)) || null,
    hasEggs: (userId) => stmt.listByUser.all(userId).length > 0,
    saveEggs,
    getCollectionSync: userId => {
      const row = stmt.getSync.get(userId);
      return row ? JSON.parse(row.metadata) : null;
    },
    /* 原子写回一颗蛋的游戏状态（读-改-写在 routes 里完成） */
    saveState: (egg) => {
      stmt.updateState.run(
        egg.coins, egg.apples, egg.water, egg.growth, egg.level,
        egg.courseDone ? 1 : 0, egg.quizCorrect || 0, egg.adopted ? 1 : 0,
        egg.id
      );
      return toPublicEgg(stmt.getById.get(egg.id));
    },
    getQuizAttempt: (id, userId, eggId) => stmt.getAttempt.get(String(id), userId, Number(eggId)) || null,
    createQuizAttempt: (id, userId, eggId, questions) => { stmt.insertAttempt.run(String(id), userId, Number(eggId), JSON.stringify(questions)); return stmt.getAttempt.get(String(id), userId, Number(eggId)); },
    settleQuizAttempt: (id, userId, eggId, answers, correct, gained) => { stmt.settleAttempt.run(JSON.stringify(answers), Number(correct), Number(gained), String(id), userId, Number(eggId)); return stmt.getAttempt.get(String(id), userId, Number(eggId)); },
    dailyQuizBest: (userId, eggId) => Number(stmt.dailyBest.get(userId, Number(eggId)).best || 0),
    close: () => db.close(),
  };
}

/* ---------- 进程内单例 ---------- */
let store = null;

function defaultPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dy.db');
}

function getStore() {
  if (!store) store = createStore(defaultPath());
  return store;
}

/* routes 直接用这些；测试可先 setStore(createStore(':memory:')) 注入 */
function setStore(s) { store = s; }

module.exports = {
  createStore,
  getStore,
  setStore,
  toPublicEgg,
  SCHEMA,
  STATE_COLUMNS,
  listEggs: (...a) => getStore().listEggs(...a),
  getEgg: (...a) => getStore().getEgg(...a),
  getEggRow: (...a) => getStore().getEggRow(...a),
  hasEggs: (...a) => getStore().hasEggs(...a),
  saveEggs: (...a) => getStore().saveEggs(...a),
  getCollectionSync: (...a) => getStore().getCollectionSync(...a),
  saveState: (...a) => getStore().saveState(...a),
  getQuizAttempt: (...a) => getStore().getQuizAttempt(...a),
  createQuizAttempt: (...a) => getStore().createQuizAttempt(...a),
  settleQuizAttempt: (...a) => getStore().settleQuizAttempt(...a),
  dailyQuizBest: (...a) => getStore().dailyQuizBest(...a),
};
