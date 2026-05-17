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

export function getFeatureByPath(pathname: string): FeatureModule | undefined {
  const normalized = pathname.replace(/\/$/, '') || '/';
  const features = getFeatures();
  const exact = features.find((f) => f.path === normalized);
  if (exact) return exact;
  return features.find((f) => f.path !== '/' && normalized.startsWith(f.path));
}
