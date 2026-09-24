/** 仓库文件读写端点：GET /api/docs、GET|PUT /api/file。 */
import fs from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { isFile } from '../../config.js';
import type { AppContext } from '../context.js';
import { safeResolve } from '../guards.js';
import { fail } from '../respond.js';

export function registerFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/docs', async (req, reply) => {
    const name = String((req.query as { name?: string }).name ?? '');
    if (!/^[\w-]+\.md$/.test(name)) return fail(reply, 400, 'invalid doc name');
    const abs = safeResolve(ctx.repoRoot, path.join('docs', name));
    if (!abs || !isFile(abs)) return fail(reply, 404, 'doc not found');
    return { content: fs.readFileSync(abs, 'utf-8') };
  });

  app.get('/api/file', async (req, reply) => {
    const abs = safeResolve(ctx.repoRoot, String((req.query as { path?: string }).path ?? ''));
    if (!abs || !isFile(abs)) return fail(reply, 404, 'file not found');
    return { content: fs.readFileSync(abs, 'utf-8') };
  });

  app.put('/api/file', async (req, reply) => {
    const rel = String((req.query as { path?: string }).path ?? '');
    const abs = rel ? safeResolve(ctx.repoRoot, rel) : null;
    if (!abs) return fail(reply, 400, 'invalid path');

    const content = (req.body as { content?: unknown })?.content;
    if (typeof content !== 'string') return fail(reply, 400, 'content required');

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    return { ok: true };
  });
}
