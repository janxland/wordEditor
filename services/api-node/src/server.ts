/** Fastify 装配：只负责框架与错误映射，业务全部在 pipeline 层。 */
import Fastify from 'fastify';

import { MAX_BODY_BYTES } from './config.js';
import { registerApiRoutes } from './http/routes/index.js';
import type { AppContext } from './http/context.js';

export function createServer(ctx: AppContext) {
  const app = Fastify({ logger: false, bodyLimit: MAX_BODY_BYTES });

  app.setErrorHandler((err, _req, reply) => {
    if (reply.raw.headersSent) return;
    const status = err.statusCode ?? 500;
    void reply.status(status).send({ error: err.message || 'internal error' });
  });

  registerApiRoutes(app, ctx);
  return app;
}
