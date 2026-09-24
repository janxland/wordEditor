/**
 * 读取 reference.docx 的样式清单：对应 pipeline/list_reference_styles.py。
 *
 * 输出面向前端「样式总览」面板：runSummary / paragraphSummary 是**给人看的中文串**，
 * 因此数字插值必须按 Python `str(float)` 的形态渲染（12 → "12.0"），否则同一份
 * reference.docx 两条链路给出的文案不一致。
 */
import { attr, child, childEls, parseXml, type XEl } from './ooxml/xml.js';
import { pythonInt } from './ooxml/util.js';
import { readPart } from './ooxml/zip.js';
import { parseCached } from './file-cache.js';

export interface StyleFonts {
  ascii?: string;
  hAnsi?: string;
  cs?: string;
  eastAsia?: string;
}

export interface RunProps {
  fonts?: StyleFonts;
  size_pt?: number;
  size_half_pt?: number;
  bold?: true;
  italic?: true;
  color?: string;
  underline?: string;
}

export interface ParagraphProps {
  align?: string;
  spacing?: {
    line_multi?: number;
    line_pt?: number;
    line_rule?: string;
    before_pt?: number | null;
    after_pt?: number | null;
  };
  indent?: Record<string, number | string | null>;
  outline_level?: number;
}

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
  run: RunProps;
  paragraph: ParagraphProps;
  runSummary: string;
  paragraphSummary: string;
}

const TYPE_RANK: Record<string, number> = {
  paragraph: 0,
  character: 1,
  table: 2,
  numbering: 3,
};

const ALIGN_LABEL: Record<string, string> = {
  left: '左',
  right: '右',
  center: '中',
  both: '两端',
  distribute: '分散',
};

/** 中文字号对照（与 Python `_CHINESE_SIZE` 同序，命中容差 0.26 磅）。 */
const CHINESE_SIZE: Array<[number, string]> = [
  [42, '初号'], [36, '小初'], [26, '一号'], [24, '小一'],
  [22, '二号'], [18, '小二'], [16, '三号'], [15, '小三'],
  [14, '四号'], [12, '小四'], [10.5, '五号'], [9, '小五'],
  [7.5, '六号'], [6.5, '小六'], [5.5, '七号'], [5, '八号'],
];

const INDENT_ATTRS = [
  'firstLine', 'firstLineChars', 'hanging', 'hangingChars', 'left', 'leftChars', 'right',
] as const;

/** 同一份 reference.docx 只解析一次：按 mtime 判新，端点每次命中都省掉整包载入。 */
export function extractReferenceStyles(referenceDocx: string): Promise<ReferenceStyle[]> {
  return parseCached(referenceDocx, readReferenceStyles);
}

async function readReferenceStyles(referenceDocx: string): Promise<ReferenceStyle[]> {
  const stylesXml = await readPart(referenceDocx, 'word/styles.xml');
  if (!stylesXml) throw new Error('reference.docx 缺少 word/styles.xml');
  const root = parseXml(stylesXml).documentElement;

  const styles: ReferenceStyle[] = [];
  for (const node of childEls(root, 'w:style')) {
    const styleId = attr(node, 'w:styleId') ?? '';
    if (!styleId) continue;
    const run = parseRpr(child(node, 'w:rPr'));
    const paragraph = parsePpr(child(node, 'w:pPr'));
    const priority = attr(child(node, 'w:uiPriority'), 'w:val') ?? '';
    styles.push({
      styleId,
      name: (attr(child(node, 'w:name'), 'w:val') ?? '') || styleId,
      type: attr(node, 'w:type') ?? '',
      isDefault: attr(node, 'w:default') === '1',
      isCustom: attr(node, 'w:customStyle') === '1',
      basedOn: attr(child(node, 'w:basedOn'), 'w:val') ?? '',
      next: attr(child(node, 'w:next'), 'w:val') ?? '',
      link: attr(child(node, 'w:link'), 'w:val') ?? '',
      uiPriority: /^\d+$/.test(priority) ? Number(priority) : null,
      qFormat: child(node, 'w:qFormat') !== undefined,
      hidden: child(node, 'w:hidden') !== undefined || child(node, 'w:semiHidden') !== undefined,
      run,
      paragraph,
      runSummary: summarizeRun(run),
      paragraphSummary: summarizeParagraph(paragraph),
    });
  }

  return styles.sort((a, b) => {
    const rank = (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
    if (rank) return rank;
    const priority = (a.uiPriority ?? 9999) - (b.uiPriority ?? 9999);
    if (priority) return priority;
    return a.styleId.toLowerCase() < b.styleId.toLowerCase() ? -1
      : a.styleId.toLowerCase() > b.styleId.toLowerCase() ? 1 : 0;
  });
}

// ─────────────────────────────── run / 段落属性 ───────────────────────────────

function parseRpr(rpr: XEl | undefined): RunProps {
  if (!rpr) return {};
  const out: RunProps = {};
  const fonts = parseRfonts(child(rpr, 'w:rFonts'));
  if (Object.keys(fonts).length) out.fonts = fonts;

  const sizeVal = attr(child(rpr, 'w:sz'), 'w:val');
  if (sizeVal) {
    const half = pythonInt(sizeVal);
    if (half !== undefined) {
      out.size_pt = round2(half / 2);
      out.size_half_pt = half;
    }
  }
  if (child(rpr, 'w:b')) out.bold = true;
  if (child(rpr, 'w:i')) out.italic = true;
  const color = attr(child(rpr, 'w:color'), 'w:val');
  if (color) out.color = color;
  const underline = attr(child(rpr, 'w:u'), 'w:val');
  if (underline) out.underline = underline;
  return out;
}

function parseRfonts(rfonts: XEl | undefined): StyleFonts {
  const out: StyleFonts = {};
  if (!rfonts) return out;
  for (const key of ['ascii', 'hAnsi', 'cs', 'eastAsia'] as const) {
    const value = attr(rfonts, `w:${key}`);
    if (value) out[key] = value;
  }
  return out;
}

function parsePpr(ppr: XEl | undefined): ParagraphProps {
  if (!ppr) return {};
  const out: ParagraphProps = {};
  const align = attr(child(ppr, 'w:jc'), 'w:val');
  if (align) out.align = align;

  const spacingEl = child(ppr, 'w:spacing');
  if (spacingEl) {
    const spacing: NonNullable<ParagraphProps['spacing']> = {};
    const line = attr(spacingEl, 'w:line');
    const rule = attr(spacingEl, 'w:lineRule') ?? 'auto';
    if (line) {
      const value = pythonInt(line);
      if (value !== undefined) {
        // 240 twips = 1.0 倍行距
        if (rule === 'auto') spacing.line_multi = round2(value / 240);
        else spacing.line_pt = round2(value / 20);
        spacing.line_rule = rule;
      }
    }
    const before = attr(spacingEl, 'w:before');
    const after = attr(spacingEl, 'w:after');
    if (before) spacing.before_pt = twipsToPt(before);
    if (after) spacing.after_pt = twipsToPt(after);
    if (Object.keys(spacing).length) out.spacing = spacing;
  }

  const indEl = child(ppr, 'w:ind');
  if (indEl) {
    const indent: Record<string, number | string | null> = {};
    for (const key of INDENT_ATTRS) {
      const value = attr(indEl, `w:${key}`);
      if (!value || value === '0') continue;
      if (key.endsWith('Chars')) {
        const n = pythonInt(value);
        indent[key] = n === undefined ? value : n / 100;
      } else {
        indent[key] = twipsToPt(value);
      }
    }
    if (Object.keys(indent).length) out.indent = indent;
  }

  const outline = child(ppr, 'w:outlineLvl');
  if (outline && attr(outline, 'w:val') !== undefined) {
    const level = pythonInt(attr(outline, 'w:val'));
    if (level !== undefined) out.outline_level = level;
  }
  return out;
}

// ─────────────────────────────── 摘要文本 ───────────────────────────────

function summarizeRun(run: RunProps): string {
  const bits: string[] = [];
  const fonts = run.fonts ?? {};
  if (fonts.eastAsia) bits.push(fonts.eastAsia);
  if (fonts.ascii && fonts.ascii !== fonts.eastAsia) bits.push(fonts.ascii);
  if (run.size_pt !== undefined) {
    const pt = fmt(run.size_pt);
    const name = chineseSizeName(run.size_pt);
    bits.push(name ? `${name}(${pt}磅)` : `${pt}磅`);
  }
  if (run.bold) bits.push('粗');
  if (run.italic) bits.push('斜');
  if (run.color) bits.push(`#${run.color}`);
  return bits.join(' ');
}

function summarizeParagraph(paragraph: ParagraphProps): string {
  const bits: string[] = [];
  if (paragraph.align) {
    bits.push(ALIGN_LABEL[paragraph.align] ?? paragraph.align);
  }
  const spacing = paragraph.spacing ?? {};
  if (spacing.line_multi !== undefined) bits.push(`行距×${fmt(spacing.line_multi)}`);
  else if (spacing.line_pt !== undefined) bits.push(`行距${fmt(spacing.line_pt)}磅(${spacing.line_rule ?? ''})`);

  const indent = paragraph.indent ?? {};
  const firstChars = indent.firstLineChars;
  const firstLine = indent.firstLine;
  if (firstChars !== undefined) bits.push(`首行${fmt(firstChars)}字符`);
  else if (firstLine !== undefined) bits.push(`首行${fmt(firstLine)}磅`);
  const hanging = indent.hangingChars;
  if (hanging !== undefined) bits.push(`悬挂${fmt(hanging)}字符`);
  return bits.join(' ');
}

function chineseSizeName(pt: number): string | null {
  for (const [value, name] of CHINESE_SIZE) {
    if (Math.abs(pt - value) < 0.26) return name;
  }
  return null;
}

// ─────────────────────────────── 数值口径 ───────────────────────────────

/** twips → 磅；空值或非法串按 Python 一样返回 null。 */
function twipsToPt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = pythonInt(raw);
  return value === undefined ? null : round2(value / 20);
}

/**
 * Python 的 `round(x, 2)`：二进制的 double 恰好落在两位小数中点的情形不存在
 * （0.005 之类本身不可精确表示），故 toFixed 的就近舍入与半偶舍入结果一致。
 */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** Python `str(float)` 会把整数值的浮点写成 `12.0`，摘要文案要靠它对齐。 */
function fmt(value: number | string | null): string {
  if (value === null) return 'None';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
