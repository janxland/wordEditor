import fs from 'node:fs';

import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import YAML from 'yaml';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

interface ProvenanceInput {
  author?: string;
  remark?: string;
  title?: string;
}

function selectNodes(select: ReturnType<typeof xpath.useNamespaces>, expr: string, node: Node): Node[] {
  const out = select(expr, node) as unknown;
  return Array.isArray(out) ? (out as Node[]) : [];
}

function selectAttr(select: ReturnType<typeof xpath.useNamespaces>, expr: string, node: Node): Attr | undefined {
  return selectNodes(select, expr, node)[0] as Attr | undefined;
}

async function readZipText(zip: JSZip, filePath: string): Promise<string | null> {
  const file = zip.file(filePath);
  if (!file) return null;
  return file.async('string');
}

function setOrCreateTextNode(doc: Document, parent: Element, tagName: string, value: string): void {
  const existed = parent.getElementsByTagName(tagName)[0];
  if (existed) {
    while (existed.firstChild) existed.removeChild(existed.firstChild);
    existed.appendChild(doc.createTextNode(value));
    return;
  }
  const node = doc.createElement(tagName);
  node.appendChild(doc.createTextNode(value));
  parent.appendChild(node);
}

function ensureChildByLocalName(doc: Document, parent: Element, localName: string): Element {
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const n = parent.childNodes[i] as Element;
    if (n.nodeType === 1 && n.localName === localName) return n;
  }
  const node = doc.createElementNS(W_NS, `w:${localName}`);
  parent.appendChild(node);
  return node;
}

function setWAttr(node: Element, name: string, value: string | number): void {
  node.setAttributeNS(W_NS, `w:${name}`, String(value));
}

export async function applyDocxMetadata(docxPath: string, provenance: ProvenanceInput): Promise<void> {
  const raw = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(raw);
  const corePath = 'docProps/core.xml';
  const fallback =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>';

  const coreXml = (await readZipText(zip, corePath)) || fallback;
  const doc = new DOMParser().parseFromString(coreXml, 'application/xml');
  const root = doc.documentElement;

  if (provenance.author) setOrCreateTextNode(doc, root, 'dc:creator', provenance.author);
  if (provenance.title) setOrCreateTextNode(doc, root, 'dc:title', provenance.title);
  if (provenance.remark) setOrCreateTextNode(doc, root, 'dc:description', provenance.remark);

  zip.file(corePath, new XMLSerializer().serializeToString(doc));
  fs.writeFileSync(docxPath, await zip.generateAsync({ type: 'nodebuffer' }));
}

export async function applyStylesYaml(docxPath: string, stylesYamlPath: string): Promise<void> {
  if (!stylesYamlPath || !fs.existsSync(stylesYamlPath)) return;
  const parsed = YAML.parse(fs.readFileSync(stylesYamlPath, 'utf-8')) as {
    overrides?: Array<{ match?: { id?: string }; paragraph?: Record<string, unknown> }>;
  };
  const overrides = Array.isArray(parsed?.overrides) ? parsed.overrides : [];
  if (overrides.length === 0) return;

  const raw = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(raw);
  const stylesPath = 'word/styles.xml';
  const stylesXml = await readZipText(zip, stylesPath);
  if (!stylesXml) return;

  const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');
  const select = xpath.useNamespaces({ w: W_NS });

  for (const item of overrides) {
    const styleId = item.match?.id;
    if (!styleId) continue;
    const styleNode = selectNodes(select, `//w:style[@w:styleId='${styleId}']`, doc)[0] as
      | Element
      | undefined;
    if (!styleNode) continue;

    const paragraph = (item.paragraph || {}) as {
      spacing_before_dxa?: number;
      spacing_after_dxa?: number;
      page_break_before?: boolean;
    };

    const pPr = ensureChildByLocalName(doc, styleNode, 'pPr');

    if (
      paragraph.spacing_before_dxa !== undefined ||
      paragraph.spacing_after_dxa !== undefined
    ) {
      const spacing = ensureChildByLocalName(doc, pPr, 'spacing');
      if (paragraph.spacing_before_dxa !== undefined) {
        setWAttr(spacing, 'before', paragraph.spacing_before_dxa);
      }
      if (paragraph.spacing_after_dxa !== undefined) {
        setWAttr(spacing, 'after', paragraph.spacing_after_dxa);
      }
    }

    if (paragraph.page_break_before === true) {
      ensureChildByLocalName(doc, pPr, 'pageBreakBefore');
    }
  }

  zip.file(stylesPath, new XMLSerializer().serializeToString(doc));
  fs.writeFileSync(docxPath, await zip.generateAsync({ type: 'nodebuffer' }));
}

export async function extractReferenceStyles(referenceDocx: string): Promise<unknown[]> {
  const raw = fs.readFileSync(referenceDocx);
  const zip = await JSZip.loadAsync(raw);
  const stylesXml = await readZipText(zip, 'word/styles.xml');
  if (!stylesXml) throw new Error('reference.docx 缺少 word/styles.xml');

  const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');
  const select = xpath.useNamespaces({ w: W_NS });
  const styleNodes = selectNodes(select, '//w:style', doc) as Element[];

  const out = styleNodes.map((node) => {
    const ui = selectAttr(select, './w:uiPriority/@w:val', node);
    const outline = selectAttr(select, './w:pPr/w:outlineLvl/@w:val', node);
    return {
      styleId: node.getAttribute('w:styleId') || '',
      name: selectAttr(select, './w:name/@w:val', node)?.value || '',
      type: node.getAttribute('w:type') || '',
      isDefault: (node.getAttribute('w:default') || '0') === '1',
      isCustom: (node.getAttribute('w:customStyle') || '0') === '1',
      basedOn: selectAttr(select, './w:basedOn/@w:val', node)?.value || '',
      next: selectAttr(select, './w:next/@w:val', node)?.value || '',
      link: selectAttr(select, './w:link/@w:val', node)?.value || '',
      uiPriority: ui && /^\d+$/.test(ui.value) ? Number(ui.value) : null,
      qFormat: selectNodes(select, './w:qFormat', node).length > 0,
      hidden: selectNodes(select, './w:hidden|./w:semiHidden', node).length > 0,
      run: {},
      paragraph: outline ? { outline_level: Number(outline.value) } : {},
      runSummary: '',
      paragraphSummary: '',
    };
  });

  out.sort((a, b) => a.styleId.localeCompare(b.styleId));
  return out;
}
