import { lazy } from 'react';
import { registerFeature } from './registry';

/**
 * 部署形态（构建期注入，VITE_EDITION=cloud 走薄前端）：
 * - full（默认，本地做单设备）：全部功能。
 * - cloud（线上下单站点）：只注册顾客服务，制作工具 chunk 根本不参与打包
 *   （常量被 vite 静态替换 → rollup 死代码消除 → 动态 import 不进产物）。
 */
const IS_CLOUD = import.meta.env.VITE_EDITION === 'cloud';

/**
 * 集中注册功能模块 —— 未来可由 JSON/远程配置驱动。
 * 导航分组：customer=顾客服务（下单人视角，放最前）/ make=制作工具 / meta=其他。
 */
export function registerAppFeatures(): void {
  // ---- 顾客服务 ----
  registerFeature({
    id: 'home',
    path: '/',
    label: '首页',
    icon: 'about',
    group: 'customer',
    order: 1,
    lazy: lazy(() => import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage }))),
  });

  registerFeature({
    id: 'orders',
    path: '/orders',
    label: '工单中心',
    icon: 'docs',
    group: 'customer',
    order: 5,
    lazy: lazy(() => import('@/pages/orders/OrdersPage').then((m) => ({ default: m.OrdersPage }))),
  });

  // 下载中心：制作人登录后可见（云端站点与桌面端都注册，方便同事随时拿安装包）
  registerFeature({
    id: 'downloads',
    path: '/downloads',
    label: '下载中心',
    icon: 'export',
    group: 'customer',
    access: 'worker',
    order: 8,
    lazy: lazy(() => import('@/pages/DownloadsPage').then((m) => ({ default: m.DownloadsPage }))),
  });

  // ---- 制作工具 + 其他（仅本地完整版注册；cloud 构建整块被消除） ----
  if (!IS_CLOUD) {
  registerFeature({
    id: 'templates',
    path: '/workbench',
    label: '模板工作台',
    icon: 'templates',
    group: 'make',
    access: 'worker',
    order: 10,
    lazy: lazy(() =>
      import('@/pages/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })),
    ),
  });

  registerFeature({
    id: 'export',
    path: '/export',
    label: '导出 Word',
    icon: 'export',
    group: 'make',
    access: 'worker',
    order: 15,
    lazy: lazy(() => import('@/pages/ExportPage').then((m) => ({ default: m.ExportPage }))),
  });

  registerFeature({
    id: 'import',
    path: '/import',
    label: 'Word 还原 MD',
    icon: 'import',
    group: 'make',
    access: 'worker',
    order: 20,
    lazy: lazy(() => import('@/pages/ImportPage').then((m) => ({ default: m.ImportPage }))),
  });

  registerFeature({
    id: 'docs',
    path: '/docs',
    label: '规范文档',
    icon: 'docs',
    group: 'make',
    access: 'worker',
    order: 25,
    lazy: lazy(() => import('@/pages/DocsPage').then((m) => ({ default: m.DocsPage }))),
  });

  // ---- 其他 ----
  registerFeature({
    id: 'about',
    path: '/about',
    label: '关于',
    icon: 'about',
    group: 'meta',
    access: 'admin',
    order: 30,
    lazy: lazy(() => import('@/pages/AboutPage').then((m) => ({ default: m.AboutPage }))),
  });
  }
}
