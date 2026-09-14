'use strict';
/* ===== 蛋养学习 · 服务入口（Step 2）=====
   同一服务提供静态前端 + JSON API */

// 必须先加载 .env，再 require 读取环境变量的模块
if (process.env.NODE_ENV !== 'test') require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const auth = require('./auth');
const authRoutes = require('./routes/auth');
const eggRoutes = require('./routes/eggs');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
app.use(auth.attachSession);

/* ---------- 静态前端 ---------- */
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------- API ---------- */
app.use('/api/auth', authRoutes.router);
app.get('/api/me', authRoutes.me);
app.use('/api/eggs', eggRoutes.router);

/* API 兜底 404（返回 JSON，不落到前端页） */
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

/* 统一错误处理：只输出安全信息，不泄露堆栈与凭证 */
app.use((err, req, res, next) => {
  console.error('[server] 未捕获错误：', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

/* 直接运行时才监听端口；被测试 require 时只导出 app，避免抢端口 */
if (require.main === module) {
  const { startServer } = require('./startup');
  startServer(app, { port: PORT, oauthConfigured: auth.isOAuthConfigured() }).catch(err => {
    console.error('[startup] 启动失败：', err.code === 'EADDRINUSE' ? '端口已占用，请先确认已有服务。' : err.message);
    process.exitCode = 1;
  });
}

module.exports = app;
