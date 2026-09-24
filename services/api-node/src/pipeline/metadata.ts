/** 文档属性写入：等价于 pipeline/apply_docx_metadata.py。 */
import { parseXml, serializeEl, ensureEl, setAttr, setText, child, addEl, type XEl } from './ooxml/xml.js';
import type { DocxSession } from './ooxml/zip.js';

export interface DocxProvenance {
  author?: string;
  remark?: string;
  title?: string;
}

const CORE_FALLBACK =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>';

/** Python `_utc_now()`：秒级 UTC ISO 串。 */
function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 等价 `_ensure_child_text`：已存在只改文本，否则追加到末尾。 */
function putText(root: XEl, tag: string, value: string): void {
  setText(ensureEl(root, tag), value);
}

function patchCore(source: string | null, p: DocxProvenance): string {
  const root = parseXml(source || CORE_FALLBACK).documentElement;
  if (p.author) {
    putText(root, 'dc:creator', p.author);
    putText(root, 'cp:lastModifiedBy', p.author);
  }
  if (p.remark) putText(root, 'dc:description', p.remark);
  if (p.title) putText(root, 'dc:title', p.title);

  const now = utcNow();
  const modified = ensureEl(root, 'dcterms:modified');
  setAttr(modified, 'xsi:type', 'dcterms:W3CDTF');
  setText(modified, now);
  if (!child(root, 'dcterms:created')) {
    const created = addEl(root, 'dcterms:created');
    setAttr(created, 'xsi:type', 'dcterms:W3CDTF');
    setText(created, now);
  }
  return serializeEl(root);
}

/** 产出留痕：Application 标记为 WordEditor，而不是宿主 Pandoc/Word 的值。 */
function patchApp(source: string | null): string | null {
  if (source === null) return null;
  const root = parseXml(source).documentElement;
  putText(root, 'Application', 'WordEditor');
  return serializeEl(root);
}

export async function applyDocxMetadata(zip: DocxSession, p: DocxProvenance): Promise<void> {
  await zip.patch({
    'docProps/core.xml': (source) => patchCore(source, p),
    'docProps/app.xml': patchApp,
  });
}
