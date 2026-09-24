/** Fastify 装配：只负责框架与错误映射，业务全部在 pipeline 层。 */
import Fastify from 'fastify';

import { MAX_BODY_BYTES } from './config.js';
import { registerApiRoutes } from './http/routes/index.js';
import type { AppContext } from './http/context.js';
import { fail } from './http/respond.js';

export function createServer(ctx: AppContext) {
  const app = Fastify({ logger: false, bodyLimit: MAX_BODY_BYTES });

  app.setErrorHandler((err, _req, reply) => {
    if (reply.raw.headersSent) return;
    void fail(reply, err.statusCode ?? 500, err.message || 'internal error');
  });

  app.setNotFoundHandler((_req, reply) => {
    void fail(reply, 404, 'Not Found');
  });

  registerApiRoutes(app, ctx);
  return app;
}
