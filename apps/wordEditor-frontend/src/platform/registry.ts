import type { FeatureModule } from './types';

const modules = new Map<string, FeatureModule>();

export function registerFeature(module: FeatureModule): void {
  if (modules.has(module.id)) {
    console.warn(`[platform] feature "${module.id}" already registered, skipping`);
    return;
  }
  modules.set(module.id, module);
}

export function getFeatures(): FeatureModule[] {
  return [...modules.values()].sort((a, b) => a.order - b.order);
}

export function getNavFeatures(): FeatureModule[] {
  return getFeatures().filter((f) => f.nav !== false);
}

export function getNavGroups(): { key: string; label: string; items: FeatureModule[] }[] {
  const GROUP_LABEL: Record<string, string> = {
    customer: '顾客服务',
    make: '制作工具',
    meta: '其他',
  };
  const groups: Record<string, FeatureModule[]> = {};
  for (const f of getNavFeatures()) {
    const key = f.group ?? 'make';
    (groups[key] ??= []).push(f);
  }
  return ['customer', 'make', 'meta']
    .filter((k) => groups[k]?.length)
    .map((key) => ({ key, label: GROUP_LABEL[key], items: groups[key] }));
}

export function getFeatureByPath(pathname: string): FeatureModule | undefined {
  const normalized = pathname.replace(/\/$/, '') || '/';
  const features = getFeatures();
  const exact = features.find((f) => f.path === normalized);
  if (exact) return exact;
  return features.find((f) => f.path !== '/' && normalized.startsWith(f.path));
}

/** 功能的访问级别（未标注一律 public：下单人可见） */
export function featureAccess(f: FeatureModule): 'public' | 'worker' | 'admin' {
  return f.access ?? 'public';
}

/**
 * 角色能否访问某访问级别的功能。角色判定来自 docOrder：
 * - worker = 制作员（含超管）；admin = 超级管理员。
 */
export function canAccess(
  access: 'public' | 'worker' | 'admin',
  role: { isWorker: boolean; isAdmin: boolean },
): boolean {
  if (access === 'public') return true;
  if (access === 'worker') return role.isWorker || role.isAdmin;
  return role.isAdmin; // admin
}

/** 便捷封装：直接按功能模块判定 */
export function canAccessFeature(
  f: FeatureModule,
  role: { isWorker: boolean; isAdmin: boolean },
): boolean {
  return canAccess(featureAccess(f), role);
}
