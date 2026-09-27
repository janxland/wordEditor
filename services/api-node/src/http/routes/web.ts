/**
 * 静态站点托管：桌面端（Electron）把前端 dist 交给本地后端同端口提供。
 *
 * 只在设置了 WORDEDITOR_WEB_DIR 且非 cloud 形态时启用 —— 云端站点由 nginx 托管静态文件，
 * 不需要 Node 再兜一层。SPA 路由全部回落 index.html。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { edition } from '../../config.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** 防目录穿越：解析后必须仍在站点根目录内 */
function safeJoin(root: string, rel: string): string | null {
  const target = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) return null;
  return target;
}

export function registerWebRoutes(app: FastifyInstance): void {
  const webDir = process.env.WORDEDITOR_WEB_DIR;
  if (!webDir || edition() === 'cloud') return;
  const root = path.resolve(webDir);
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    app.log.warn({ root }, '[web] WORDEDITOR_WEB_DIR 下没有 index.html，跳过静态托管');
    return;
  }

  // 只接 GET/HEAD，且不覆盖 /api/* 与契约端点（业务路由先注册，Fastify 以先注册者优先）
  app.get('/*', async (req, reply) => {
    const rawPath = (req.params as { '*': string })['*'] ?? '';
    // 业务前缀交给业务路由：这里直接 404，避免抢路由
    if (rawPath.startsWith('api/') || rawPath === 'openapi.json' || rawPath === 'docs') {
      return reply.code(404).send({ detail: 'Not Found' });
    }
    if (!rawPath) {
      return reply.type('text/html; charset=utf-8').send(fs.createReadStream(path.join(root, 'index.html')));
    }
    const filePath = safeJoin(root, rawPath);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return reply
        .type(MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
        .send(fs.createReadStream(filePath));
    }
    return reply.type('text/html; charset=utf-8').send(fs.createReadStream(path.join(root, 'index.html')));
  });

  app.log.info({ root }, '[web] 已托管前端静态站点');
}
