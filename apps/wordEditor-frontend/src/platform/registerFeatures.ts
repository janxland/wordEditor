import { lazy } from 'react';
import { registerFeature } from './registry';

/** 集中注册功能模块 —— 未来可由 JSON/远程配置驱动 */
export function registerAppFeatures(): void {
  registerFeature({
    id: 'export',
    path: '/export',
    label: '导出 Word',
    icon: 'export',
    order: 10,
    lazy: lazy(() => import('@/pages/ExportPage').then((m) => ({ default: m.ExportPage }))),
  });

  registerFeature({
    id: 'templates',
    path: '/',
    label: '模板工作台',
    icon: 'templates',
    order: 20,
    lazy: lazy(() =>
      import('@/pages/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })),
    ),
  });

  registerFeature({
    id: 'vba',
    path: '/vba',
    label: 'VBA 宏',
    icon: 'vba',
    order: 30,
    lazy: lazy(() => import('@/pages/VbaPage').then((m) => ({ default: m.VbaPage }))),
  });

  registerFeature({
    id: 'docs',
    path: '/docs',
    label: '规范文档',
    icon: 'docs',
    order: 40,
    lazy: lazy(() => import('@/pages/DocsPage').then((m) => ({ default: m.DocsPage }))),
  });
}
