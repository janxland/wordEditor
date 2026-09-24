/** 仓库文件读写端点：GET /api/docs、GET|PUT /api/file。 */
import fs from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { isFile } from '../../config.js';
import { insideDir } from '../../fs-utils.js';
import type { AppContext } from '../context.js';
import { badRequest, fromQuery, HttpError, mustMatch, strOf } from '../params.js';

/** 仓库内的普通文件：越界与不存在都按 404 回（不区分，免得给探测者信息）。 */
function repoFile(repoRoot: string, rel: string, notFound: string): string {
  const abs = insideDir(repoRoot, rel);
  if (!abs || !isFile(abs)) throw new HttpError(404, notFound);
  return abs;
}

export function registerFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/docs', async (req) => {
    const name = mustMatch(strOf(fromQuery(req), 'name'), /^[\w-]+\.md$/, 'invalid doc name');
    const abs = repoFile(ctx.repoRoot, path.join('docs', name), 'doc not found');
    return { content: fs.readFileSync(abs, 'utf-8') };
  });

  app.get('/api/file', async (req) => {
    const abs = repoFile(ctx.repoRoot, strOf(fromQuery(req), 'path'), 'file not found');
    return { content: fs.readFileSync(abs, 'utf-8') };
  });

  app.put('/api/file', async (req) => {
    const rel = strOf(fromQuery(req), 'path');
    const abs = rel ? insideDir(ctx.repoRoot, rel) : null;
    if (!abs) throw badRequest('invalid path');

    const content = (req.body as { content?: unknown })?.content;
    if (typeof content !== 'string') throw badRequest('content required');

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    return { ok: true };
  });
}
