'use strict';
/* ===== /api/auth/* 与 /api/me（Step 2）===== */

const express = require('express');
const auth = require('../auth');

const router = express.Router();

/* 发起登录：跳转知乎授权页；未配置凭证时走 Mock（仅开发） */
router.get('/login', (req, res) => {
  if (!auth.isOAuthConfigured()) {
    if (!auth.mockLoginAllowed()) {
      return res.status(503).json({ error: '未配置知乎 OAuth 凭证，且当前环境不允许 Mock 登录' });
    }
    const sid = auth.ensureSid(req, res);
    auth.upgradeSession(sid, auth.MOCK_USER, { accessToken: null, expiresIn: 0 });
    console.warn('[auth] 未配置 OAuth 凭证，已使用 Mock 登录（仅开发用，勿用于线上）');
    return res.redirect('/');
  }

  const sid = auth.ensureSid(req, res);
  const state = auth.issueState(sid);
  res.redirect(auth.buildAuthorizeUrl(state));
});

/* 授权回调：校验 state → 换 Token → 取用户信息 → 建会话 */
router.get('/callback', async (req, res) => {
  // 实测回调参数为 authorization_code；兼容 code
  const code = req.query.authorization_code || req.query.code;
  const state = req.query.state;

  if (!auth.consumeState(state, req.sid)) {
    return res.status(400).send('登录校验失败：state 缺失、不匹配或已过期，请返回重新登录。');
  }
  if (!code) {
    return res.status(400).send('登录失败：未收到授权码。');
  }

  try {
    const token = await auth.exchangeCode(String(code));
    const profile = await auth.fetchZhihuUser(token.accessToken);
    auth.upgradeSession(req.sid, profile, token);
    res.redirect('/');
  } catch (err) {
    // 只回传安全信息；绝不包含 code / app_key / access_token
    console.error('[auth] 登录失败：', err.message);
    res.status(502).send('登录失败，请稍后重试。');
  }
});

function logout(req, res) {
  auth.destroySession(req.sid);
  auth.clearSessionCookie(res);
  if (req.get('accept') && req.get('accept').includes('text/html')) return res.redirect('/');
  res.json({ ok: true });
}

router.get('/logout', logout);
router.post('/logout', logout);

/* GET /api/me —— 当前登录用户 */
function me(req, res) {
  const s = req.session;
  if (!s || !s.uid) return res.status(401).json({ error: '未登录' });
  res.json({ uid: s.uid, name: s.name, avatar: s.avatar });
}

module.exports = { router, me };
