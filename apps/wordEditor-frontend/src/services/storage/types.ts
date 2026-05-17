import type { DslDocument, MacroEntry, TemplatesConfig } from '@/core/types';

export interface IStorageAdapter {
  readonly id: string;
  getTemplatesConfig(): Promise<TemplatesConfig>;
  readText(relativePath: string): Promise<string>;
  writeText(relativePath: string, content: string): Promise<void>;
  listMacros(): Promise<MacroEntry[]>;
  readDoc(name: string): Promise<string>;
}

export interface TemplateAssets {
  entry: import('@/core/types').TemplateEntry;
  stylesYaml?: string;
  luaFilters: { path: string; content: string }[];
}
