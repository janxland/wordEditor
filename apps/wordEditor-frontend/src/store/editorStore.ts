import { create } from 'zustand';
import type { DslDocument, EditorTab, TemplateEntry } from '@/core/types';
import { parseDslYaml, stringifyDslYaml, validateDslYaml } from '@/core/yaml';
import { getStorage } from '@/services/storage';
import { useAppStore } from './appStore';

interface DirtyMap {
  [path: string]: boolean;
}

interface EditorState {
  selectedTemplateId: string | null;
  activeTab: EditorTab;
  stylesPath: string | null;
  dslDoc: DslDocument | null;
  yamlText: string;
  fileCache: Record<string, string>;
  dirty: DirtyMap;
  workspaceReady: boolean;

  initWorkspace: () => Promise<void>;
  selectTemplate: (id: string) => Promise<void>;
  setActiveTab: (tab: EditorTab) => void;
  loadFile: (path: string) => Promise<string>;
  updateFile: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  setYamlText: (text: string) => void;
  syncYamlFromDoc: () => void;
  syncDocFromYaml: () => boolean;
  updateDsl: (updater: (doc: DslDocument) => DslDocument) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedTemplateId: null,
  activeTab: 'overview',
  stylesPath: null,
  dslDoc: null,
  yamlText: '',
  fileCache: {},
  dirty: {},
  workspaceReady: false,

  initWorkspace: async () => {
    const config = useAppStore.getState().config;
    if (!config) return;
    const id = get().selectedTemplateId ?? config.default_template;
    await get().selectTemplate(id);
    set({ workspaceReady: true });
  },

  selectTemplate: async (id) => {
    const config = useAppStore.getState().config;
    const entry = config?.templates.find((t) => t.id === id);
    if (!entry) return;

    const prevTab = get().activeTab;
    // 仅当当前 Tab 在新模板下会被禁用时才回退；否则保留用户视角
    const tabStillValid = (tab: EditorTab): boolean => {
      if (tab === 'overview' || tab === 'styles') return true;
      if (tab === 'visual' || tab === 'yaml') return Boolean(entry.styles_yaml);
      if (tab === 'lua') return Boolean(entry.extra_lua_filters?.length);
      return true;
    };

    set({ selectedTemplateId: id, stylesPath: entry.styles_yaml ?? null });

    if (entry.styles_yaml) {
      try {
        const text = await get().loadFile(entry.styles_yaml);
        const doc = parseDslYaml(text);
        set({
          dslDoc: doc,
          yamlText: text,
          activeTab: tabStillValid(prevTab) ? prevTab : 'visual',
        });
      } catch {
        set({
          dslDoc: null,
          yamlText: '',
          activeTab: tabStillValid(prevTab) ? prevTab : 'overview',
        });
      }
    } else {
      set({
        dslDoc: null,
        yamlText: '',
        activeTab: tabStillValid(prevTab) ? prevTab : 'overview',
      });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadFile: async (path) => {
    const cached = get().fileCache[path];
    if (cached !== undefined) return cached;
    const content = await getStorage().readText(path);
    set((s) => ({ fileCache: { ...s.fileCache, [path]: content } }));
    return content;
  },

  updateFile: (path, content) => {
    set((s) => ({
      fileCache: { ...s.fileCache, [path]: content },
      dirty: { ...s.dirty, [path]: true },
    }));
    const { stylesPath } = get();
    if (path === stylesPath) {
      set({ yamlText: content });
      const v = validateDslYaml(content);
      if (v.ok) set({ dslDoc: v.doc });
    }
  },

  saveFile: async (path) => {
    const content = get().fileCache[path];
    if (content === undefined) return;
    await getStorage().writeText(path, content);
    set((s) => {
      const dirty = { ...s.dirty };
      delete dirty[path];
      return { dirty };
    });
  },

  setYamlText: (text) => {
    const { stylesPath } = get();
    if (stylesPath) get().updateFile(stylesPath, text);
    else set({ yamlText: text });
    const v = validateDslYaml(text);
    if (v.ok) set({ dslDoc: v.doc });
  },

  syncYamlFromDoc: () => {
    const { dslDoc, stylesPath } = get();
    if (!dslDoc) return;
    const text = stringifyDslYaml(dslDoc);
    if (stylesPath) get().updateFile(stylesPath, text);
    set({ yamlText: text });
  },

  syncDocFromYaml: () => {
    const v = validateDslYaml(get().yamlText);
    if (!v.ok) return false;
    set({ dslDoc: v.doc });
    return true;
  },

  updateDsl: (updater) => {
    const { dslDoc } = get();
    if (!dslDoc) return;
    const next = updater(structuredClone(dslDoc));
    set({ dslDoc: next });
    get().syncYamlFromDoc();
  },
}));

export function getSelectedTemplate(
  state: EditorState,
  templates: TemplateEntry[] | undefined,
): TemplateEntry | undefined {
  return templates?.find((t) => t.id === state.selectedTemplateId);
}
