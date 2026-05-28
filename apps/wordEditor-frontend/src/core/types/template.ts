export interface TemplateEntry {
  id: string;
  name: string;
  reference_doc: string;
  source?: string;
  note?: string;
  /** 独立模板：不加载 config 根级 lua_filter，样式与过滤器均在本目录 */
  standalone?: boolean;
  lua_filter?: string;
  extra_lua_filters?: string[];
  styles_yaml?: string;
  /** 标题多级编号：gongke=1/1.1/1.1.1，guanke=一、/1.1/1.1.1 */
  heading_numbering?: 'gongke' | 'guanke';
}

/** 按构建顺序返回模板应加载的 Lua 过滤器路径 */
export function getTemplateLuaFilters(
  entry: TemplateEntry,
  config: TemplatesConfig | null | undefined,
): string[] {
  const paths: string[] = [];
  if (!entry.standalone && config?.lua_filter) {
    paths.push(config.lua_filter);
  }
  if (entry.lua_filter) {
    paths.push(entry.lua_filter);
  }
  if (entry.extra_lua_filters?.length) {
    paths.push(...entry.extra_lua_filters);
  }
  return paths;
}

export interface TemplatesConfig {
  default_template: string;
  lua_filter?: string;
  templates: TemplateEntry[];
}

export type EditorTab = 'visual' | 'yaml' | 'lua' | 'overview' | 'styles';
