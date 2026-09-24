/** 模板注册表：读取 config/templates.json 并把相对路径解析为绝对路径。 */
import fs from 'node:fs';
import path from 'node:path';

import { isFile } from '../config.js';
import { parseCached } from './file-cache.js';

/** 与模板目录同级的历史别名。 */
const TEMPLATE_ALIASES: Record<string, string> = {
  'hutb-shared': 'hutb-guanke',
};

const FALLBACK_TEMPLATE_ID = 'hutb-guanke';

export interface TemplateDef {
  id: string;
  name: string;
  standalone?: boolean;
  heading_numbering?: 'gongke' | 'guanke';
  reference_doc: string;
  lua_filter?: string;
  extra_lua_filters?: string[];
  styles_yaml?: string;
  three_line_tables?: boolean;
  source?: string;
  cover_block?: string;
  tail_block?: string;
  note?: string;
  /** GET /api/templates 附带，非配置文件字段。 */
  reference_exists?: boolean;
}

export interface TemplatesConfig {
  default_template?: string;
  templates: TemplateDef[];
}

export interface ResolvedTemplate {
  def: TemplateDef;
  referenceDoc: string;
  luaFilters: string[];
  stylesYaml: string | null;
  coverBlock: string | null;
  tailBlock: string | null;
}

export function loadTemplatesConfig(repoRoot: string): TemplatesConfig {
  const file = path.join(repoRoot, 'config', 'templates.json');
  return parseCached(file, (f) => JSON.parse(fs.readFileSync(f, 'utf-8')) as TemplatesConfig);
}

export function templateIdFor(cfg: TemplatesConfig, templateId?: string): string {
  const raw = (templateId || cfg.default_template || FALLBACK_TEMPLATE_ID).trim();
  return TEMPLATE_ALIASES[raw] ?? raw;
}

export function findTemplate(cfg: TemplatesConfig, templateId?: string): TemplateDef {
  const id = templateIdFor(cfg, templateId);
  const found = cfg.templates.find((t) => t.id === id);
  if (found) return found;
  throw new Error(`未知模板 '${id}'。可用: ${cfg.templates.map((t) => t.id).join(', ')}`);
}

/** build.py:resolve_lua_filters —— 模板必须配置 lua_filter。 */
export function resolveTemplate(repoRoot: string, def: TemplateDef): ResolvedTemplate {
  if (!def.lua_filter) {
    throw new Error(`模板「${def.name}」须在 templates.json 中配置 lua_filter。`);
  }
  const filters = [def.lua_filter, ...(def.extra_lua_filters ?? [])].map((rel) =>
    path.join(repoRoot, rel),
  );
  return {
    def,
    referenceDoc: path.join(repoRoot, def.reference_doc),
    luaFilters: filters.filter((f) => fs.existsSync(f)),
    stylesYaml: def.styles_yaml ? path.join(repoRoot, def.styles_yaml) : null,
    coverBlock: def.cover_block ? path.join(repoRoot, def.cover_block) : null,
    tailBlock: def.tail_block ? path.join(repoRoot, def.tail_block) : null,
  };
}

/** GET /api/templates：附带 reference.docx 是否就位。 */
export function withTemplateStatus(repoRoot: string, cfg: TemplatesConfig): TemplatesConfig {
  return {
    ...cfg,
    templates: cfg.templates.map((t) => ({
      ...t,
      reference_exists: isFile(path.join(repoRoot, t.reference_doc ?? '')),
    })),
  };
}
