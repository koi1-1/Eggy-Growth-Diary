'use strict';

/* 在实际服务进程中探测网络，不携带凭证，不读取用户数据。
   无凭证的 401/403 也说明 HTTPS 链路可达；连通不代表 OAuth 授权成功。 */
async function checkZhihuConnection(fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl('https://openapi.zhihu.com/user', {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (response.body) await response.body.cancel();
  } catch {
    throw new Error('无法连接知乎开放平台。请在允许外网访问的终端启动服务；若由代理启动，请申请受限环境外执行权限。');
  }
  if (response.status >= 500 || response.status === 429) {
    throw new Error(`知乎开放平台暂不可用（HTTP ${response.status}），请稍后重新启动。`);
  }
  return response.status;
}

async function startServer(app, { port, oauthConfigured, fetchImpl = globalThis.fetch, log = console.log }) {
  if (oauthConfigured) {
    log(`[startup] PID ${process.pid}：检查知乎 HTTPS 连通性（无凭证）…`);
    const status = await checkZhihuConnection(fetchImpl);
    log(`[startup] PID ${process.pid}：知乎网络检查 HTTP ${status}；OAuth 授权仍需用户确认。`);
  }
  // 只有同一个 Node 进程已通过网络检查，才开放登录入口。
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      log(`蛋养学习 → http://127.0.0.1:${server.address().port}（PID ${process.pid}）`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

module.exports = { checkZhihuConnection, startServer };
