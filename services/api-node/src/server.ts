/** Fastify 装配：只负责框架与错误映射，业务全部在 pipeline 层。 */
import Fastify from 'fastify';

import { MAX_BODY_BYTES } from './config.js';
import { registerApiRoutes } from './http/routes/index.js';
import type { AppContext } from './http/context.js';
import { fail } from './http/respond.js';

export function createServer(ctx: AppContext) {
  const app = Fastify({
    // 结构化访问日志走 Fastify 自带的 pino，不额外引依赖；WORDEDITOR_LOG_LEVEL=warn 可静音。
    logger: { level: process.env.WORDEDITOR_LOG_LEVEL ?? 'info' },
    bodyLimit: MAX_BODY_BYTES,
    // 故意不设 connectionTimeout / requestTimeout：两者在 Node 里都是「套接字静默」超时，
    // 而一路 Pandoc 会有几十秒不写字节（实测 5s 就会掐断 SSE）。慢速头部攻击由 Node 自带的
    // headersTimeout(60s) 兜住，跨反代的静默由心跳帧兜住。
    forceCloseConnections: true,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (reply.raw.headersSent) return;
    // ajv 的「缺必填字段」翻译成与 api-python 手写检查同字的 detail。
    const missing = err.validation?.find((v) => v.keyword === 'required');
    if (missing) return void fail(reply, 400, `${missing.params.missingProperty} is required`);
    void fail(reply, err.statusCode ?? 500, err.message || 'internal error');
  });

  app.setNotFoundHandler((_req, reply) => {
    void fail(reply, 404, 'Not Found');
  });

  registerApiRoutes(app, ctx);
  return app;
}
