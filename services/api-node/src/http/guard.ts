/**
 * 接口权限守卫 —— 「谁能碰哪个端点」只在这张表里定，端点里不再各写一遍鉴权。
 *
 * 分级：
 *   公开    ：健康检查、接口契约、登录注册 —— 不能把还没登录的人挡在门外
 *   登录即可：模板列表 / 参考样式 / 导出 / 导入 / 样式预览 / 文档读取
 *   制作员  ：PUT /api/file —— 写仓库就是改模板、styles.yaml、lua 过滤器，等于改全站版式
 *
 * 用户来源：Bearer token → AuthCenter /auth-center/profile（docorder/auth.ts，带 5 分钟缓存）。
 * 关闭：WORDEDITOR_AUTH=off，仅供本地离线跑 Pandoc 回归；服务器上不要开。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { isWorkerUser, requireUser, type AuthedUser } from '../docorder/auth.js';
import { HttpError } from './params.js';

export interface AuthedRequest extends FastifyRequest {
  authUser?: AuthedUser;
}

const PUBLIC_ROUTES = new Set([
  'GET /',
  'GET /api/health',
  'GET /api/tools',
  'GET /openapi.json',
  'GET /docs',
  'POST /api/auth/login',
  'POST /api/auth/register',
]);

/** 写仓库 = 模板制作，只有制作员能碰 */
const WORKER_ROUTES = new Set(['PUT /api/file']);

export function authEnabled(): boolean {
  return (process.env.WORDEDITOR_AUTH ?? 'on').trim().toLowerCase() !== 'off';
}

/** 路由键：`GET /api/templates`，query 无关 */
export function routeKey(req: FastifyRequest): string {
  return `${req.method} ${req.url.split('?')[0]}`;
}

export function registerAuthGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const key = routeKey(req);
    if (!authEnabled() || PUBLIC_ROUTES.has(key)) return;
    // 桌面端静态资源（/assets/*、favicon 等非 /api 路径）不设防，守卫只管 API
    if (!req.url.startsWith('/api') && req.url !== '/openapi.json' && req.url !== '/docs') return;

    try {
      const user = await requireUser(req.headers.authorization);
      (req as AuthedRequest).authUser = user;
      if (WORKER_ROUTES.has(key) && !isWorkerUser(user)) {
        throw new HttpError(403, '需要制作员权限（doc-worker）');
      }
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.status(err.statusCode ?? 401).send({ detail: err.message });
    }
  });
}
