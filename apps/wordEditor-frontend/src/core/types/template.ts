export interface TemplateEntry {
  id: string;
  name: string;
  reference_doc: string;
  source?: string;
  note?: string;
  extra_lua_filters?: string[];
  styles_yaml?: string;
}

export interface TemplatesConfig {
  default_template: string;
  lua_filter?: string;
  templates: TemplateEntry[];
}

export interface MacroEntry {
  name: string;
  file: string;
}

export type EditorTab = 'visual' | 'yaml' | 'lua' | 'overview';
