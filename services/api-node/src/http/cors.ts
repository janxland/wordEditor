/**
 * 桌面端跨域放行 —— Electron 窗口直接加载云端站点（word.roginx.ink），
 * 登录后的构建/导入/pandoc 管线请求改打本地后端（127.0.0.1:PORT），属跨源。
 *
 * 开关：WORDEDITOR_CORS_ORIGIN（逗号分隔，支持 `http://localhost:*` 端口通配）；
 * 未设置 = 完全关闭（云端部署不带这个 env，行为不变）。
 *
 * 注意注册顺序：必须在鉴权守卫之前 —— 浏览器的 OPTIONS 预检不带 Authorization，
 * 落到守卫会 401，预检一挂正式请求就全废了。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const corsConfig = (): string[] =>
  (process.env.WORDEDITOR_CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function originAllowed(origin: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === origin) return true;
    if (p.endsWith(':*') && origin.startsWith(p.slice(0, -1))) return true; // http://localhost:* → 前缀匹配
  }
  return false;
}

export function registerDesktopCors(app: FastifyInstance): void {
  const patterns = corsConfig();
  if (!patterns.length) return;
  app.log.info({ patterns }, '[cors] 桌面端跨域放行已启用');

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (!origin || !originAllowed(origin, patterns)) return;

    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Credentials', 'false');

    if (req.method === 'OPTIONS') {
      reply
        .header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
        .header('Access-Control-Allow-Headers', 'Authorization,Content-Type')
        .header('Access-Control-Max-Age', '600')
        .code(204);
      return reply.send();
    }
  });
}
