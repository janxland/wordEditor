import YAML from 'yaml';
import type { DslDocument } from './types';

export function parseDslYaml(text: string): DslDocument {
  const doc = YAML.parse(text) as DslDocument;
  if (!doc?.template?.id) {
    throw new Error('无效的 styles.yaml：缺少 template.id');
  }
  doc.overrides ??= [];
  doc.custom_styles ??= [];
  doc.fonts ??= {};
  return doc;
}

export function stringifyDslYaml(doc: DslDocument): string {
  return YAML.stringify(doc, {
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  });
}

export function validateDslYaml(text: string): { ok: true; doc: DslDocument } | { ok: false; error: string } {
  try {
    const doc = parseDslYaml(text);
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
