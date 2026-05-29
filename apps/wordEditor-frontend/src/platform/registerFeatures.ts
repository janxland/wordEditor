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
    id: 'import',
    path: '/import',
    label: 'Word 还原 MD',
    icon: 'import',
    order: 15,
    lazy: lazy(() => import('@/pages/ImportPage').then((m) => ({ default: m.ImportPage }))),
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
    id: 'docs',
    path: '/docs',
    label: '规范文档',
    icon: 'docs',
    order: 30,
    lazy: lazy(() => import('@/pages/DocsPage').then((m) => ({ default: m.DocsPage }))),
  });
}
