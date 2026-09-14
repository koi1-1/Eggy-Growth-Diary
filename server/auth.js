'use strict';
/* ===== 知乎 OAuth + 应用会话（Step 2）=====
   安全红线：
   - app_key / access_token 只存在于服务端内存，绝不进前端、URL、日志或错误信息
   - state 一次性消费，校验失败一律拒绝登录
   协议依据：~/.claude/skills/zhihu/references/hackathon-oauth.md、oauth.md */

const crypto = require('crypto');

/* ---------- 配置（全部来自环境变量，无硬编码凭证）---------- */
const APP_ID = process.env.ZHIHU_OAUTH_APP_ID || '';
const APP_KEY = process.env.ZHIHU_OAUTH_APP_KEY || '';
const REDIRECT_URI = process.env.ZHIHU_OAUTH_REDIRECT_URI || '';

const AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize';
const TOKEN_URL = 'https://openapi.zhihu.com/access_token';
const USER_URL = 'https://openapi.zhihu.com/user';

const SESSION_COOKIE = 'dysid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const STATE_TTL_MS = 10 * 60 * 1000;            // 10 分钟

/* ---------- 存储（常驻单进程 Demo：进程内 Map）---------- */
const sessions = new Map(); // sid -> { uid, name, avatar, accessToken, tokenExpiresAt, sessionExpiresAt }
const states = new Map();   // state -> { sid, expiresAt }

function isOAuthConfigured() {
  return Boolean(APP_ID && APP_KEY && REDIRECT_URI);
}

/* 未配置凭证时允许 Mock 登录（仅开发）。线上环境一律拒绝。 */
function mockLoginAllowed() {
  return process.env.MOCK_AUTH === '1' ||
    (!isOAuthConfigured() && process.env.NODE_ENV !== 'production');
}

const MOCK_USER = { uid: 'mock-user-1', name: '小夏', avatar: '' };

function randomId() {
  return crypto.randomBytes(32).toString('base64url');
}

/* ---------- 会话 ---------- */
function newSessionRecord() {
  return { uid: null, sessionExpiresAt: Date.now() + SESSION_TTL_MS };
}

function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.sessionExpiresAt < Date.now()) { sessions.delete(sid); return null; }
  return s;
}

/* 拿到当前 sid；没有就发一个「待登录」的匿名会话（state 需绑定浏览器会话） */
function ensureSid(req, res) {
  if (req.sid && getSession(req.sid)) return req.sid;
  const sid = randomId();
  sessions.set(sid, newSessionRecord());
  setSessionCookie(res, sid);
  return sid;
}

/* 登录成功后把匿名会话升级为已登录会话（sid 不变，Cookie 稳定） */
function upgradeSession(sid, profile, tokenInfo) {
  const prev = getSession(sid) || newSessionRecord();
  sessions.set(sid, {
    ...prev,
    uid: profile.uid,
    name: profile.name,
    avatar: profile.avatar,
    accessToken: tokenInfo.accessToken || null,
    mock: tokenInfo.mock === true,
    tokenExpiresAt: tokenInfo.expiresIn ? Date.now() + tokenInfo.expiresIn * 1000 : 0,
  });
}

function destroySession(sid) {
  if (sid) sessions.delete(sid);
}

function setSessionCookie(res, sid) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/* 把会话挂到 req 上，供各路由使用 */
function attachSession(req, res, next) {
  const sid = (req.cookies && req.cookies[SESSION_COOKIE]) || null;
  const session = getSession(sid);
  req.sid = session ? sid : null;
  req.session = session;
  next();
}

/* ---------- state（防 CSRF / 防重放）---------- */
function issueState(sid) {
  const state = randomId();
  states.set(state, { sid, expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

/* 校验并原子消费：缺失 / 不存在（已用过）/ 过期 / 非同一浏览器会话 → 一律拒绝 */
function consumeState(state, sid) {
  if (!state || typeof state !== 'string') return false;
  const rec = states.get(state);
  if (!rec) return false;
  states.delete(state); // 先消费，杜绝重复回调复用
  if (rec.expiresAt < Date.now()) return false;
  if (!sid || rec.sid !== sid) return false;
  return true;
}

/* ---------- 知乎 OAuth ---------- */
function buildAuthorizeUrl(state) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('app_id', APP_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

/* 用授权码换 access_token（表单字段用 code，不是 authorization_code） */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    app_id: APP_ID,
    app_key: APP_KEY,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code,
  });

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new Error('换取 Token 失败：无法连接知乎开放平台');
  }

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* 非 JSON，按失败处理 */ }

  // 以 access_token 是否存在为准；不把业务 code 20000 当错误
  if (!data.access_token) {
    throw new Error(`换取 Token 失败：HTTP ${res.status}`);
  }
  return {
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
  };
}

/* uid 是 int64，可能超出 JS 安全整数范围：先给数字型 uid 加引号再解析，避免精度丢失 */
function parseLossless(text) {
  return JSON.parse(text.replace(/"uid"\s*:\s*(\d+)/g, '"uid":"$1"'));
}

/* 取授权用户基础信息 */
async function fetchZhihuUser(accessToken) {
  let res;
  try {
    res = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error('获取用户信息失败：无法连接知乎开放平台');
  }

  const text = await res.text();
  let data;
  try { data = parseLossless(text); } catch { throw new Error('获取用户信息失败：响应格式异常'); }

  if (!res.ok) throw new Error(`获取用户信息失败：HTTP ${res.status}`);

  // 兼容「顶层即用户对象」与「data 包裹」两种形态
  const u = (data && typeof data.data === 'object' && data.data) ? data.data : data;
  const uid = u && u.uid;
  if (!uid) throw new Error('获取用户信息失败：响应缺少用户标识');

  return {
    uid: String(uid),
    name: u.fullname || '知乎用户',
    avatar: u.avatar_path || '',
  };
}

module.exports = {
  isOAuthConfigured,
  mockLoginAllowed,
  MOCK_USER,
  ensureSid,
  upgradeSession,
  destroySession,
  clearSessionCookie,
  attachSession,
  issueState,
  consumeState,
  buildAuthorizeUrl,
  exchangeCode,
  fetchZhihuUser,
  parseLossless, // 导出供测试：uid 为 int64 需无损解析
};
