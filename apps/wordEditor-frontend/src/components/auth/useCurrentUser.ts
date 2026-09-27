/** 当前登录用户 —— 薄封装：实际状态在 authStore（zustand），全应用共用同一份 */
import { useAuthStore } from '@/store/authStore';
import type { AuthUser } from '@/services/docOrder';

export function useCurrentUser(): AuthUser | null {
  return useAuthStore((s) => s.user);
}
