import { create } from 'zustand';
import type { MacroEntry, TemplatesConfig } from '@/core/types';
import { getStorage } from '@/services/storage';

/** 应用级状态：配置与跨功能共享数据 */
interface AppState {
  config: TemplatesConfig | null;
  macros: MacroEntry[];
  macrosLoaded: boolean;
  loading: boolean;
  apiReady: boolean | null;
  error: string | null;

  bootstrap: () => Promise<void>;
  loadMacros: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  config: null,
  macros: [],
  macrosLoaded: false,
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

  loadMacros: async () => {
    if (get().macrosLoaded) return;
    try {
      const macros = await getStorage().listMacros();
      set({ macros, macrosLoaded: true });
    } catch {
      /* VBA 页可离线提示 */
    }
  },
}));
