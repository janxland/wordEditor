import Fastify from 'fastify';

import { MAX_BODY_BYTES } from './config/env.js';
import { registerApiRoutes } from './routes/api.js';

export function createApp(repoRoot: string, cacheDir: string) {
  const app = Fastify({ logger: false, bodyLimit: MAX_BODY_BYTES });

  app.setErrorHandler((err, req, reply) => {
    if (reply.raw.headersSent) return;
    reply.status(500).send({ error: err.message || 'internal error' });
  });

  void registerApiRoutes(app, { repoRoot, cacheDir });
  return app;
}
