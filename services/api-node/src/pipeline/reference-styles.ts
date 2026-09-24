/**
 * 读取 reference.docx 的样式清单：对应 pipeline/list_reference_styles.py。
 *
 * run / paragraph 的完整解析（字号、行距、缩进、字体四变量、摘要文本）随
 * styles DSL 阶段一并移植。
 */
import { attr, child, childEls, descendants, parseXml } from './ooxml/xml.js';
import { readPart } from './ooxml/zip.js';
export interface ReferenceStyle {
  styleId: string;
  name: string;
  type: string;
  isDefault: boolean;
  isCustom: boolean;
  basedOn: string;
  next: string;
  link: string;
  uiPriority: number | null;
  qFormat: boolean;
  hidden: boolean;
  run: Record<string, unknown>;
  paragraph: Record<string, unknown>;
  runSummary: string;
  paragraphSummary: string;
}

export async function extractReferenceStyles(referenceDocx: string): Promise<ReferenceStyle[]> {
  const stylesXml = await readPart(referenceDocx, 'word/styles.xml');
  if (!stylesXml) throw new Error('reference.docx 缺少 word/styles.xml');
  const root = parseXml(stylesXml).documentElement;

  return childEls(root, 'w:style')
    .map((node) => {
      const outline = attr(child(node, 'w:pPr/w:outlineLvl'), 'w:val');
      const priority = Number(attr(child(node, 'w:uiPriority'), 'w:val'));
      return {
        styleId: attr(node, 'w:styleId') ?? '',
        name: attr(child(node, 'w:name'), 'w:val') ?? '',
        type: attr(node, 'w:type') ?? '',
        isDefault: attr(node, 'w:default') === '1',
        isCustom: attr(node, 'w:customStyle') === '1',
        basedOn: attr(child(node, 'w:basedOn'), 'w:val') ?? '',
        next: attr(child(node, 'w:next'), 'w:val') ?? '',
        link: attr(child(node, 'w:link'), 'w:val') ?? '',
        uiPriority: Number.isFinite(priority) ? priority : null,
        qFormat: descendants(node, 'w:qFormat').length > 0,
        hidden:
          descendants(node, 'w:hidden').length > 0 || descendants(node, 'w:semiHidden').length > 0,
        run: {},
        paragraph: outline ? { outline_level: Number(outline) } : {},
        runSummary: '',
        paragraphSummary: '',
      };
    })
    .sort((a, b) => a.styleId.localeCompare(b.styleId));
}
