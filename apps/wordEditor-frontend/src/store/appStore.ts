import { create } from 'zustand';
import { getStorage } from '@/services/storage';
import type { TemplatesConfig } from '@/core/types/template';

/** 应用级状态：配置与跨功能共享数据 */
interface AppState {
  config: TemplatesConfig | null;
  loading: boolean;
  apiReady: boolean | null;
  error: string | null;

  /** 已有配置时直接返回（登录/切页反复调用不打接口），无配置才真正拉取 */
  bootstrap: () => Promise<void>;
  /** 登录态变化后强制重取（旧的那次多半是 401 失败） */
  rebootstrap: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  config: null,
  loading: false,
  apiReady: null,
  error: null,

  bootstrap: async () => {
    if (get().config) {
      set({ loading: false, error: null, apiReady: true });
      return;
    }
    await get().rebootstrap();
  },

  rebootstrap: async () => {
    // cloud 站点（下单人）没有模板后端，配置恒为空，跳过拉取避免报错横幅
    if (import.meta.env.VITE_EDITION === 'cloud') {
      set({ config: { default_template: '', templates: [] }, loading: false, apiReady: true, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const storage = getStorage();
      const config = await storage.getTemplatesConfig();
      set({ config, loading: false, apiReady: true });
    } catch (e) {
      set({
        loading: false,
        apiReady: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
}));
