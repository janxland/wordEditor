import { create } from 'zustand';
import type { TemplatesConfig } from '@/core/types';
import { getStorage } from '@/services/storage';

/** 应用级状态：配置与跨功能共享数据 */
interface AppState {
  config: TemplatesConfig | null;
  loading: boolean;
  apiReady: boolean | null;
  error: string | null;

  bootstrap: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  config: null,
  loading: false,
  apiReady: null,
  error: null,

  bootstrap: async () => {
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
