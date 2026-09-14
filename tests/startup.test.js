'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { checkZhihuConnection, startServer } = require('../server/startup');

test('startup: credential-free probe cancels the body and accepts authentication-required responses', async () => {
  for (const status of [200, 401, 403]) {
    let cancelled = false;
    const result = await checkZhihuConnection(async (url, options) => {
      assert.equal(url, 'https://openapi.zhihu.com/user');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers, undefined);
      assert.equal(options.body, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return { status, body: { cancel: async () => { cancelled = true; } } };
    });
    assert.equal(result, status);
    assert.equal(cancelled, true);
  }
});

test('startup: blocked network never opens the login server or exposes raw errors', async () => {
  const app = { listen() { assert.fail('must not listen after probe failure'); } };
  await assert.rejects(startServer(app, {
    port: 0, oauthConfigured: true, log() {},
    fetchImpl: async () => { throw new Error('sensitive-raw-network-detail'); },
  }), err => /允许外网/.test(err.message) && !err.message.includes('sensitive-raw'));
});

test('startup: rate limits and upstream failures are not considered ready', async () => {
  for (const status of [429, 500, 502, 503]) {
    await assert.rejects(checkZhihuConnection(async () => new Response('', { status })), /暂不可用/);
  }
});

test('startup: the tested server listens only after connectivity succeeds; mock mode stays offline', async () => {
  for (const oauthConfigured of [true, false]) {
    let probes = 0;
    const logs = [];
    const server = await startServer(express(), {
      port: 0, oauthConfigured, log: message => logs.push(message),
      fetchImpl: async () => { probes++; return new Response('', { status: 200 }); },
    });
    try {
      assert.equal(probes, oauthConfigured ? 1 : 0);
      assert.ok(server.listening);
      assert.match(logs.at(-1), /蛋养学习.*PID/);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
