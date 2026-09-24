/** 路由注册入口：/api/* 的端点集合与 api-python 保持一致。 */
import type { FastifyInstance } from 'fastify';

import type { AppContext } from '../context.js';
import { registerBuildRoutes } from './build.js';
import { registerFileRoutes } from './files.js';
import { registerImportRoutes } from './import.js';
import { registerSystemRoutes } from './system.js';
import { registerTemplateRoutes } from './templates.js';

export function registerApiRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerSystemRoutes(app, ctx);
  registerTemplateRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerBuildRoutes(app, ctx);
  registerImportRoutes(app, ctx);
}
