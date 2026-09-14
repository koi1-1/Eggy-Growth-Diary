'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.DEEPSEEK_API_KEY = 'test-key';
const llm = require('../server/llm');
const zhihu = require('../server/zhihu');
const db = require('../server/db');
const { router, getEggs } = require('../server/routes/eggs');
const express = require('express');

test('AI ids are mapped independently; duplicate/missing/empty output uses original summary', async t => {
  t.mock.method(global, 'fetch', async () => Response.json({ choices: [{ message: { content: JSON.stringify({ posts: [
    { sourceId: 2, paragraphs: ['第二篇总结'] },
    { sourceId: 1, paragraphs: ['错误重复项'] }, { sourceId: 1, paragraphs: ['另一个重复项'] },
    { sourceId: 3, paragraphs: ['编造空摘要内容'] }, { sourceId: 999, paragraphs: ['不存在来源'] },
  ] }) } }] }));
  const sources = [
    { title: 'A 校面试', url: 'https://www.zhihu.com/answer/1', text: 'A 校考察项目贡献。' },
    { title: 'B 校面试', url: 'https://www.zhihu.com/answer/2', text: 'B 校考察数学。' },
    { title: '无摘要', url: 'javascript:alert(1)', text: '' },
  ];
  const course = await llm.generatePostSummaries('保研升学', sources);
  assert.equal(course.lessons.length, 3);
  assert.deepEqual(course.lessons[0].paragraphs, [sources[0].text]);
  assert.deepEqual(course.lessons[1].paragraphs, ['第二篇总结']);
  assert.deepEqual(course.lessons[2].paragraphs, []);
  assert.equal(course.refs.length, 2);
  assert.equal(course.lessons[2].refNumber, null);
});

test('HTTP uses exact theme membership, never searches knowledge, and invalidates on sync', async t => {
  const store = db.createStore(':memory:'); db.setStore(store);
  const items = [
    { title: 'Python 入门', summary: '变量的定义。', url: 'https://www.zhihu.com/answer/1' },
    { title: '保研经验', summary: '数学面试。', url: 'https://www.zhihu.com/answer/2' },
  ];
  const session = { uid: 'summary-test', accessToken: 'test-token' };
  t.mock.method(zhihu, 'readCollections', async () => ({ items, mock: false }));
  t.mock.method(zhihu, 'searchKnowledge', () => { assert.fail('No knowledge request expected'); });
  t.mock.method(llm, 'clusterThemesWithMeta', async () => ({ eggs: llm.clusterByRules(items), method: 'rules' }));
  t.mock.method(llm, 'generatePostSummaries', async (theme, sources) => ({ format: 'post-summaries', sources, by: 'rules' }));
  const first = await getEggs(session, { force: true });
  const app = express();
  app.use((req, res, next) => { req.session = session; next(); }); app.use('/api/eggs', router);
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); store.close(); });
  const get = async id => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/eggs/${id}/course`); return { status: r.status, body: await r.json() }; };
  for (const egg of first.eggs) {
    const r = await get(egg.id); assert.equal(r.status, 200);
    assert.equal(r.body.course.sources.length, 1);
    assert.equal(r.body.course.sources[0].title.includes(egg.theme === 'Python 编程' ? 'Python' : '保研'), true);
  }
  const python = first.eggs.find(e => e.theme === 'Python 编程');
  assert.equal((await get(python.id)).body.cached, true);
  items[0].summary = '更新后的变量定义。';
  await getEggs(session, { force: true });
  assert.equal((await get(python.id)).body.course.sources[0].text, items[0].summary);
  const orphan = store.saveEggs('summary-test', [...first.eggs, { theme: '量子物理' }], 'collections').find(e => e.theme === '量子物理');
  assert.equal((await get(orphan.id)).status, 422);
});
