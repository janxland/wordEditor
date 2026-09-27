/** 路由注册入口：/api/* 的端点集合与 api-python 保持一致。 */
import type { FastifyInstance } from 'fastify';

import type { AppContext } from '../context.js';
import { edition } from '../../config.js';
import { registerAuthGuard } from '../guard.js';
import { registerBuildRoutes } from './build.js';
import { registerDocOrderRoutes } from '../../docorder/routes.js';
import { registerDownloadRoutes } from './downloads.js';
import { registerFileRoutes } from './files.js';
import { registerImportRoutes } from './import.js';
import { registerSystemRoutes } from './system.js';
import { registerTemplateRoutes } from './templates.js';
import { registerWebRoutes } from './web.js';

/**
 * 部署形态：
 * - full（默认，本地做单设备）：完整能力，需要 pandoc + api-python。
 * - cloud（线上 word.roginx.ink）：薄后端 —— 只做鉴权 + 工单 + 附件中转，
 *   不注册任何模板/构建/导入路由，服务器无需安装 pandoc。
 */
export function registerApiRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerAuthGuard(app); // 先挂守卫，后挂业务：任何新增端点默认被保护
  registerSystemRoutes(app, ctx);
  registerDocOrderRoutes(app, ctx);
  registerDownloadRoutes(app, ctx); // 下载中心：两种形态都要（制作人从云端站点/桌面端拿安装包）
  if (edition() === 'cloud') {
    app.log.info('[edition=cloud] 薄后端：模板/构建/导入路由未注册');
    return;
  }
  registerTemplateRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerBuildRoutes(app, ctx);
  registerImportRoutes(app, ctx);
  registerWebRoutes(app); // 静态站点兜底，必须最后注册，避免抢业务路由
}
