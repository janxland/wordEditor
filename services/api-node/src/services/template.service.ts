import fs from 'node:fs';
import path from 'node:path';

import { TEMPLATE_ALIASES } from '../config/env.js';

export interface TemplateConfig {
  id: string;
  name: string;
  heading_numbering?: string;
  reference_doc: string;
  lua_filter: string;
  extra_lua_filters?: string[];
  styles_yaml?: string;
  three_line_tables?: boolean;
  note?: string;
  [key: string]: unknown;
}

export interface TemplatesConfig {
  default_template?: string;
  templates: TemplateConfig[];
}

export function loadTemplatesConfig(repoRoot: string): TemplatesConfig {
  const p = path.join(repoRoot, 'config', 'templates.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as TemplatesConfig;
}

export function resolveTemplate(cfg: TemplatesConfig, templateId?: string): TemplateConfig {
  const raw = templateId || cfg.default_template || 'hutb-guanke';
  const id = TEMPLATE_ALIASES[raw] || raw;
  const found = cfg.templates.find((t) => t.id === id);
  if (!found) {
    const ids = cfg.templates.map((t) => t.id).join(', ');
    throw new Error(`未知模板 '${id}'。可用: ${ids}`);
  }
  return found;
}

export function withTemplateStatus(repoRoot: string, cfg: TemplatesConfig): TemplatesConfig {
  return {
    ...cfg,
    templates: cfg.templates.map((t) => ({
      ...t,
      reference_exists: fs.existsSync(path.join(repoRoot, t.reference_doc)),
    })),
  };
}

export function resolveLuaFilters(repoRoot: string, template: TemplateConfig): string[] {
  const filters = [path.join(repoRoot, template.lua_filter)];
  for (const rel of template.extra_lua_filters || []) {
    filters.push(path.join(repoRoot, rel));
  }
  return filters.filter((f) => fs.existsSync(f));
}
