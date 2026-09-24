/** 文档属性写入：等价于 pipeline/apply_docx_metadata.py。 */
import { parseXml, serializeEl, setText, child, addEl } from './ooxml/xml.js';
import { patchDocxParts } from './ooxml/zip.js';

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

function setCoreText(source: string | null, tag: string, value: string): string {
  const doc = parseXml(source || CORE_FALLBACK);
  const root = doc.documentElement;
  const existing = child(root, tag);
  if (existing) {
    setText(existing, value);
  } else {
    setText(addEl(root, tag), value);
  }
  return serializeEl(root);
}

/** 返回实际写入的属性数量，便于与 Python 的日志对齐。 */
export async function applyDocxMetadata(
  docxPath: string,
  provenance: DocxProvenance,
): Promise<number> {
  const writes = (
    [
      ['dc:creator', provenance.author],
      ['dc:title', provenance.title],
      ['dc:description', provenance.remark],
    ] as const
  ).filter(([, value]) => Boolean(value));
  if (writes.length === 0) return 0;

  await patchDocxParts(docxPath, {
    'docProps/core.xml': (source) => {
      let xml = source;
      for (const [tag, value] of writes) xml = setCoreText(xml, tag, value!);
      return xml;
    },
  });
  return writes.length;
}
