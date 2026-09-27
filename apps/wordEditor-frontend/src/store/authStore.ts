/**
 * 登录态 store —— 全应用唯一响应式入口。
 *
 * docOrder 负责持久化（localStorage）与广播（wordeditor.auth-changed 事件），
 * 这里订阅该事件并把用户变成 zustand 状态：任何组件 useAuthStore 即时响应，
 * 登录/退出不再需要刷新页面。apiFetch / 业务请求层继续读 currentUser()（同步读取，无环依赖）。
 */
import { create } from 'zustand';

import { currentUser, logout as apiLogout, type AuthUser } from '@/services/docOrder';

interface AuthState {
  user: AuthUser | null;
  /** 登录 / 退出 / token 变化都会触发（同一对象才通知订阅者） */
  sync: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: currentUser(),
  sync: () => {
    const next = currentUser();
    // 引用不同才 set，避免重复事件导致全树重渲染
    if (get().user !== next) set({ user: next });
  },
  logout: () => apiLogout(),
}));

// 事件 → store 的唯一桥：docOrder.setAuth 每次变更都会广播
window.addEventListener('wordeditor.auth-changed', () => useAuthStore.getState().sync());
