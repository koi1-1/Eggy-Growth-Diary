'use strict';
/* ===== 养成链路端到端测试（Step 5.1）=====
   真起一个 Express 进程 + 临时 SQLite，用 Mock 登录走完整 HTTP 流程。
   不联网：ZHIHU_ACCESS_SECRET / DEEPSEEK_API_KEY 均未设置，
   因此收藏走内置假数据、聚类走规则算法。

   跑法：npm test */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `dy-test-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.MOCK_AUTH = '1';
process.env.NODE_ENV = 'test';
delete process.env.ZHIHU_ACCESS_SECRET;
delete process.env.DEEPSEEK_API_KEY;

const app = require('../server/index.js');
const db = require('../server/db.js');

let server;
let base;
let cookie = '';

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

/* 带 Cookie 的请求；redirect 手动处理，便于断言登录跳转 */
async function req(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
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

let eggId;

test('未登录访问 /api/eggs 返回 401', async () => {
  const r = await req('GET', '/api/eggs');
  assert.equal(r.status, 401);
});

test('Mock 登录后拿到会话 Cookie', async () => {
  const r = await req('GET', '/api/auth/login');
  assert.equal(r.status, 302);
  assert.match(cookie, /dysid=/);
});

test('GET /api/eggs 返回 6 颗未领养的蛋 + 数值规则', async () => {
  const r = await req('GET', '/api/eggs');
  assert.equal(r.status, 200);
  assert.equal(r.data.eggs.length, 6);
  assert.ok(r.data.eggs.every((e) => e.adopted === false), '初始应都未领养');
  // 数值规则随接口下发，前端文案才不会和后端漂移
  assert.equal(r.data.meta.rules.coinPerCourse, 30);
  assert.equal(r.data.meta.rules.coinPerCorrect, 10);
  assert.deepEqual(r.data.meta.rules.price, { apple: 10, water: 5 });
  assert.deepEqual(r.data.meta.rules.growthPer, { apple: 15, water: 10 });
  eggId = r.data.eggs[0].id;
});

test('领养发放新手礼包 50 金币 + 1 苹果 + 1 水滴', async () => {
  const r = await req('POST', `/api/eggs/${eggId}/adopt`);
  assert.equal(r.status, 200);
  assert.equal(r.data.egg.adopted, true);
  assert.equal(r.data.egg.coins, 50);
  assert.equal(r.data.egg.apples, 1);
  assert.equal(r.data.egg.water, 1);
});

test('重复领养幂等：不重复发礼包', async () => {
  await req('POST', `/api/eggs/${eggId}/exchange`, { item: 'water' }); // 先把金币花掉一些
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;

  const r = await req('POST', `/api/eggs/${eggId}/adopt`);
  assert.equal(r.status, 200);
  assert.equal(r.data.alreadyAdopted, true);
  assert.equal(r.data.egg.coins, before.coins, '金币不应被重置回 50');
  assert.equal(r.data.egg.water, before.water, '水滴不应被重置');
});

test('喂苹果：扣 1 个苹果、+15 成长值', async () => {
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  const r = await req('POST', `/api/eggs/${eggId}/feed`, { type: 'apple' });
  assert.equal(r.status, 200);
  assert.equal(r.data.gained, 15);
  assert.equal(r.data.egg.apples, before.apples - 1);
  assert.equal(r.data.egg.growth, before.growth + 15);
});

test('喂水：扣 1 个水滴、+10 成长值', async () => {
  await req('POST', `/api/eggs/${eggId}/exchange`, { item: 'water' });
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  const r = await req('POST', `/api/eggs/${eggId}/feed`, { type: 'water' });
  assert.equal(r.status, 200);
  assert.equal(r.data.gained, 10);
  assert.equal(r.data.egg.water, before.water - 1);
  assert.equal(r.data.egg.growth, before.growth + 10);
});

test('资源不足时喂养被拒（400）', async () => {
  // 先把苹果喂光
  let guard = 0;
  while ((await req('GET', `/api/eggs/${eggId}`)).data.egg.apples > 0) {
    await req('POST', `/api/eggs/${eggId}/feed`, { type: 'apple' });
    assert.ok(++guard < 50, '喂养循环未能结束，苹果数没有正常递减');
  }
  const r = await req('POST', `/api/eggs/${eggId}/feed`, { type: 'apple' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /不够/);
});

test('非法喂养类型被拒（400）', async () => {
  const r = await req('POST', `/api/eggs/${eggId}/feed`, { type: 'pizza' });
  assert.equal(r.status, 400);
});

test('兑换苹果：扣 10 金币、+1 苹果', async () => {
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  const r = await req('POST', `/api/eggs/${eggId}/exchange`, { item: 'apple' });
  assert.equal(r.status, 200);
  assert.equal(r.data.spent, 10);
  assert.equal(r.data.egg.coins, before.coins - 10);
  assert.equal(r.data.egg.apples, before.apples + 1);
});

test('金币不足时兑换被拒（400）', async () => {
  // 把金币花到不够 10
  let egg = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  while (egg.coins >= 10) {
    await req('POST', `/api/eggs/${eggId}/exchange`, { item: 'water' });
    egg = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  }
  const r = await req('POST', `/api/eggs/${eggId}/exchange`, { item: 'apple' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /金币不够/);
});

test('学完课程 +30 金币，且只能领一次', async () => {
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  const first = await req('POST', `/api/eggs/${eggId}/course-done`);
  assert.equal(first.status, 200);
  assert.equal(first.data.gained, 30);
  assert.equal(first.data.egg.coins, before.coins + 30);
  assert.equal(first.data.egg.courseDone, true);

  const second = await req('POST', `/api/eggs/${eggId}/course-done`);
  assert.equal(second.status, 400);
  assert.match(second.data.error, /已经学过/);
});

test('复习结算：每答对 1 题 +10 金币', async () => {
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  const r = await req('POST', `/api/eggs/${eggId}/quiz`, { correct: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.data.gained, 20);
  assert.equal(r.data.egg.coins, before.coins + 20);
});

test('复习答对数被夹住：上报 999 只按 3 题结算（防虚报）', async () => {
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  const r = await req('POST', `/api/eggs/${eggId}/quiz`, { correct: 999 });
  assert.equal(r.status, 200);
  assert.equal(r.data.correct, 3, '应被夹到题目上限 3');
  assert.equal(r.data.gained, 30);
  assert.equal(r.data.egg.coins, before.coins + 30);
});

test('复习答对数为负数时按 0 结算', async () => {
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  const r = await req('POST', `/api/eggs/${eggId}/quiz`, { correct: -5 });
  assert.equal(r.data.correct, 0);
  assert.equal(r.data.gained, 0);
  assert.equal(r.data.egg.coins, before.coins);
});

test('复习最好成绩只增不减', async () => {
  await req('POST', `/api/eggs/${eggId}/quiz`, { correct: 3 });
  const after3 = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  assert.equal(after3.quizCorrect, 3);

  await req('POST', `/api/eggs/${eggId}/quiz`, { correct: 1 });
  const after1 = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  assert.equal(after1.quizCorrect, 3, '重考更差不应覆盖最好成绩');
});

test('成长值满 100 时升级并归零', async () => {
  // 重置到「差一点满级」的状态：直接喂到满
  let egg = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  let leveledUp = false;
  for (let i = 0; i < 40 && !leveledUp; i++) {
    // 保证有苹果可喂
    egg = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
    if (egg.apples <= 0) {
      await req('POST', `/api/eggs/${eggId}/quiz`, { correct: 3 }); // 赚金币
      const r = await req('POST', `/api/eggs/${eggId}/exchange`, { item: 'apple' });
      if (r.status !== 200) break;
    }
    const fed = await req('POST', `/api/eggs/${eggId}/feed`, { type: 'apple' });
    if (fed.status !== 200) break;
    leveledUp = fed.data.leveledUp;
  }
  assert.equal(leveledUp, true, '连续喂养后应触发升级');

  egg = (await req('GET', `/api/eggs/${eggId}`)).data.egg;
  assert.ok(egg.level >= 2, '等级应已提升');
  assert.ok(egg.growth < 100, '升级后成长值应归零重算');
});

test('跨用户隔离：别人的蛋一律 404', async () => {
  const store = db.getStore();
  const rows = store.saveEggs('someone-else', [
    { theme: '别人的蛋', desc: '', size: 'md', tone: 1, count: 0 },
  ], 'collections');
  const otherId = rows[0].id;

  for (const p of [`/api/eggs/${otherId}`, `/api/eggs/${otherId}/adopt`]) {
    const method = p.endsWith('adopt') ? 'POST' : 'GET';
    const r = await req(method, p);
    assert.equal(r.status, 404, `${method} ${p} 应返回 404`);
  }

  const feed = await req('POST', `/api/eggs/${otherId}/feed`, { type: 'apple' });
  assert.equal(feed.status, 404);
  const ex = await req('POST', `/api/eggs/${otherId}/exchange`, { item: 'apple' });
  assert.equal(ex.status, 404);
});

test('重新聚类只更新主题元信息，不冲掉养成进度', async () => {
  const before = (await req('GET', `/api/eggs/${eggId}`)).data.egg;

  const r = await req('GET', '/api/eggs?refresh=1');
  assert.equal(r.status, 200);

  const after = r.data.eggs.find((e) => e.id === eggId);
  assert.ok(after, '已领养的蛋在重新聚类后应仍然存在');
  assert.equal(after.coins, before.coins, '金币不应被重新聚类重置');
  assert.equal(after.apples, before.apples);
  assert.equal(after.water, before.water);
  assert.equal(after.level, before.level);
  assert.equal(after.courseDone, true, '课程进度不应丢失');
});

test('数据落盘：另开一个连接能读到同样的状态', async () => {
  const fromApi = (await req('GET', `/api/eggs/${eggId}`)).data.egg;

  const probe = db.createStore(TMP_DB);
  const fromDisk = probe.getEgg(eggId);
  probe.close();

  assert.equal(fromDisk.coins, fromApi.coins);
  assert.equal(fromDisk.growth, fromApi.growth);
  assert.equal(fromDisk.level, fromApi.level);
  assert.equal(fromDisk.adopted, true);
});

test('非法蛋 id 返回 404', async () => {
  assert.equal((await req('GET', '/api/eggs/abc')).status, 404);
  assert.equal((await req('GET', '/api/eggs/999999')).status, 404);
});
