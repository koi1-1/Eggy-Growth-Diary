'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
process.env.DEEPSEEK_API_KEY = '';
const zhihu = require('../server/zhihu');
const llm = require('../server/llm');
const db = require('../server/db');
const express = require('express');
const { router } = require('../server/routes/eggs');
const item = (title, summary = '') => ({ title, summary, url: 'https://www.zhihu.com/question/123/answer/456', type: 'answer' });

test('rules: unrelated titles never become fixed recommended topics', () => {
  const items = [item('鱼缸过滤系统如何选择', '学习知识，阅读代码，团队拆解'), item('水草灯具选购')];
  const eggs = llm.clusterByRules(items);
  assert.deepEqual(eggs.map(e => e.theme), items.map(i => i.title));
  assert.ok(eggs.every(e => e.count > 0 && e.basis === 'title'));
  assert.equal(eggs[0].evidence[0].title, items[0].title);
});

test('rules: matched and unmatched items are all represented', () => {
  const items = [item('Python 入门'), ...Array.from({ length: 12 }, (_, i) => item(`水草灯具${i}`))];
  const eggs = llm.clusterByRules(items);
  assert.equal(new Set(eggs.flatMap(e => e.indices)).size, items.length);
  assert.ok(eggs.length <= items.length);
  assert.ok(!eggs.some(e => e.theme === '其他近期收藏'));
  assert.ok(eggs.every(e => e.evidence.length <= 1));
});

test('specific subjects win over generic learning and career keywords', () => {
  const eggs = llm.clusterByRules([
    item('计算机保研经验'), item('概率论与数理统计一周复习'), item('AI Coding 招实习生'),
  ]);
  assert.deepEqual(new Set(eggs.map(e => e.theme)), new Set(['保研升学', '概率统计', 'AI 编程']));
  assert.ok(eggs.every(e => e.count === 1));
});

test('empty collections generate no recommended eggs', async () => {
  assert.deepEqual(await llm.clusterThemesWithMeta([]), { eggs: [], method: 'none', reason: 'empty' });
});

test('AI metadata reflects actual fallback and discards unsupported themes', async t => {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  delete require.cache[require.resolve('../server/llm')];
  const ai = require('../server/llm');
  process.env.DEEPSEEK_API_KEY = '';
  let fail = true;
  t.mock.method(global, 'fetch', async () => {
    if (fail) return new Response('{}', { status: 503 });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ eggs: [
      { theme: '水草养护', keywords: ['水草'] },
      { theme: '不存在主题', keywords: ['虚构关键词'] },
    ] }) } }] });
  });
  const items = [item('水草养护方法')];
  assert.equal((await ai.clusterThemesWithMeta(items)).reason, 'llm_failed');
  assert.equal((await ai.clusterThemesWithMeta(items)).method, 'rules');
  fail = false;
  const result = await ai.clusterThemesWithMeta(items);
  assert.equal(result.method, 'llm');
  assert.deepEqual(result.eggs.map(e => e.theme), ['水草养护']);
});

test('missing OAuth token fails; only explicit Mock sessions use fixtures', async () => {
  assert.throws(() => zhihu.readCollections(null), /缺少知乎授权/);
  assert.equal((await zhihu.readCollections(null, { allowMock: true })).mock, true);
});

test('Zhihu API validates structure and sends OAuth identity without leaking credentials', async t => {
  let payload = { Code: 0, Data: { Items: [{ Title: '真实标题', Summary: '摘要', Url: 'https://www.zhihu.com/question/1' }] } };
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(new URL(url).searchParams.get('Limit'), '50');
    assert.equal(options.headers['X-OAuth-Token'], 'test-oauth');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return new Response(JSON.stringify(payload));
  });
  const data = await zhihu.readCollections('test-oauth');
  assert.equal(data.mock, false);
  assert.equal(data.items[0].title, '真实标题');
  payload = { Code: 0, Data: {} };
  await assert.rejects(zhihu.readCollections('test-oauth'), /缺少收藏列表/);
  payload = { Code: 20001, Message: 'test-secret test-oauth' };
  await assert.rejects(zhihu.readCollections('test-oauth'), e => !e.message.includes('test-secret') && /20001/.test(e.message));
});

test('HTTP refresh provenance, cache, failure, empty state and user isolation', async t => {
  const store = db.createStore(':memory:');
  db.setStore(store);
  let uid = 'user-a';
  const app = express();
  app.use((req, res, next) => { req.session = { uid, accessToken: 'test-oauth' }; next(); });
  app.use('/api/eggs', router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); store.close(); });
  let reads = 0;
  let fail = false;
  let items = [item('Python 入门'), item('水草灯具选购')];
  t.mock.method(zhihu, 'readCollections', async () => {
    reads++;
    if (fail) throw new Error('读取收藏失败：业务码 30002');
    await new Promise(resolve => setTimeout(resolve, 20));
    return { items, mock: false };
  });
  const get = async (suffix = '') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/eggs${suffix}`);
    return { status: response.status, body: await response.json() };
  };
  const first = (await get()).body;
  assert.equal(first.meta.collectionCount, 2);
  assert.equal(first.meta.llm, false);
  assert.equal(first.meta.cached, false);
  assert.equal(first.eggs[0].evidence[0].title, 'Python 入门');
  const adopted = store.getEgg(first.eggs[0].id);
  store.saveState({ ...adopted, adopted: true, coins: 73 });
  const cached = (await get()).body;
  assert.equal(cached.meta.cached, true);
  assert.equal(cached.meta.updatedAt, first.meta.updatedAt);
  assert.equal(reads, 1);
  await Promise.all([get('?refresh=1'), get('?refresh=1')]);
  assert.equal(reads, 2);
  fail = true;
  assert.equal((await get('?refresh=1')).status, 502);
  assert.equal((await get()).body.meta.collectionCount, 2);
  fail = false;
  items = [];
  const empty = (await get('?refresh=1')).body;
  assert.equal(empty.meta.status, 'empty');
  assert.equal(empty.eggs.length, 1);
  assert.equal(empty.eggs[0].basis, 'historical');
  assert.equal(empty.eggs[0].coins, 73);
  assert.equal(empty.eggs[0].count, 0);
  uid = 'user-b';
  assert.equal((await get()).body.eggs.length, 0);
  const previousReads = reads;
  assert.equal((await get()).body.meta.cached, true);
  assert.equal(reads, previousReads);
});

test('SQLite rolls back egg changes if metadata cannot be saved', () => {
  const store = db.createStore(':memory:');
  try {
    const circular = {}; circular.self = circular;
    assert.throws(() => store.saveEggs('a', [{ theme: 'new' }], 'collections', circular));
    assert.equal(store.hasEggs('a'), false);
    assert.equal(store.getCollectionSync('a'), null);
  } finally { store.close(); }
});
