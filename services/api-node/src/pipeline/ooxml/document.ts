/**
 * 文档结构后处理：等价于 pipeline/postprocess_document.py。
 *
 * - 标题：识别「一、」「1.1」等 → 去掉前缀 → 套用 Heading 样式并挂多级编号
 * - 引用：正文 [N] / [1,2] → REF 书签域 + 上标
 * - 表题：「表1 xxx」且紧跟表格的段落 → 套用「表注」样式
 */
import {
  allDescendants,
  attr,
  child,
  childEls,
  descendants,
  ensureEl,
  insertEl,
  qName,
  type XEl,
} from './xml.js';
import {
  HUTB_HEADING_NUM_ID,
  appendRefField,
  appendTextRun,
  bookmarkStartsInParagraph,
  collectBookmarkNames,
  paragraphPlainText,
  parseHeadingLine,
  rebuildParagraphContent,
  resolveHeadingStyleIds,
  setParagraphHeadingStyle,
  styleIdForHeadingLevel,
  superscriptRpr,
} from './util.js';

const REF_IN_TEXT = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const TABLE_CAPTION_FALLBACK = /^\s*表(?:格)?\s*\d+[\s．.：:、　]*\S/;
/** 与 hutb-base.yaml custom_styles.id / Pandoc custom-style 一致。 */
const TABLE_CAPTION_STYLE_ID = '表注';
const CODE_STYLE_IDS = new Set(['SourceCode', 'VerbatimChar']);

/**
 * 代码 / 含硬换行的段落不参与「重排 run」的改写：rebuild 会清空全部子元素按纯文本重排，
 * w:br / w:tab 会被整批丢弃（代码附录里的 x[:, 1] 恰好命中 [1] 书签）。
 */
function isVerbatimParagraph(p: XEl): boolean {
  const style = child(p, 'w:pPr/w:pStyle');
  if (style && CODE_STYLE_IDS.has(attr(style, 'w:val') ?? '')) return true;
  return allDescendants(p).some((el) => qName(el) === 'w:br' || qName(el) === 'w:tab');
}

function bodyOf(root: XEl): XEl {
  return child(root, 'w:body') ?? root;
}

/** 标题识别；只改 document.xml（编号本体由 styles 阶段的 DSL 写入）。 */
export function applyHeadings(documentRoot: XEl, stylesRoot: XEl): number {
  const headingIds = resolveHeadingStyleIds(stylesRoot);
  if (headingIds.size === 0) return 0;

  let changed = 0;
  for (const p of childEls(bodyOf(documentRoot))) {
    if (qName(p) !== 'w:p') continue;
    const parsed = parseHeadingLine(paragraphPlainText(p));
    if (!parsed) continue;
    const { level, title } = parsed;
    if (!headingIds.has(level) || !title) continue;

    let styleId: string;
    try {
      styleId = styleIdForHeadingLevel(level, headingIds);
    } catch {
      continue;
    }
    setParagraphHeadingStyle(p, styleId, title, {
      numId: HUTB_HEADING_NUM_ID,
      ilvl: level - 1,
    });
    changed += 1;
  }
  return changed;
}

interface RefSegment {
  start: number;
  end: number;
  nums: string[];
}

/** 定位本段可替换的引用：组内任一编号缺书签则整组保持原样。 */
function collectRefSegments(text: string, docBookmarks: Set<string>, bmk: Map<string, number>): RefSegment[] {
  const out: RefSegment[] = [];
  for (const m of text.matchAll(new RegExp(REF_IN_TEXT.source, 'g'))) {
    const nums = m[1]!.split(',').map((n) => n.trim());
    if (nums.some((n) => !docBookmarks.has(`Ref${n}`))) continue;
    if (nums.some((n) => bmk.has(`Ref${n}`) && Math.abs((bmk.get(`Ref${n}`) ?? 0) - m.index!) <= 1)) {
      continue;
    }
    out.push({ start: m.index!, end: m.index! + m[0].length, nums });
  }
  return out;
}

export function applyRefs(documentRoot: XEl): number {
  const docBookmarks = collectBookmarkNames(documentRoot);
  if (docBookmarks.size === 0) return 0;

  let changed = 0;
  for (const p of descendants(documentRoot, 'w:p')) {
    if (isVerbatimParagraph(p)) continue;
    const text = paragraphPlainText(p);
    if (!text.includes('[')) continue;
    const segments = collectRefSegments(text, docBookmarks, bookmarkStartsInParagraph(p));
    if (!segments.length) continue;

    const doc = p.ownerDocument;
    const rpr = superscriptRpr(doc);
    rebuildParagraphContent(p, (target) => {
      let pos = 0;
      for (const { start, end, nums } of segments) {
        if (start > pos) appendTextRun(target, text.slice(pos, start));
        appendRefRuns(target, nums, rpr);
        pos = end;
      }
      if (pos < text.length) appendTextRun(target, text.slice(pos));
    });
    changed += 1;
  }
  return changed;
}

/**
 * 单个编号 → 一个完整 REF 域；多个编号共用一对方括号：方括号与逗号随上标走，
 * 编号本体各挂一个 REF 域。
 */
function appendRefRuns(p: XEl, nums: string[], rpr: XEl): void {
  if (nums.length === 1) {
    appendRefField(p, `Ref${nums[0]}`, nums[0]!, rpr);
    return;
  }
  appendTextRun(p, '[', rpr);
  nums.forEach((num, i) => {
    if (i) appendTextRun(p, ',', rpr);
    appendRefField(p, `Ref${num}`, num, rpr, false);
  });
  appendTextRun(p, ']', rpr);
}

/** 兜底：识别「表1 / 表格 1 …」且后面紧跟表格的段落，套用「表注」样式。 */
export function applyTableCaptionFallback(documentRoot: XEl): number {
  const children = childEls(bodyOf(documentRoot));
  let changed = 0;

  children.forEach((childEl, i) => {
    if (qName(childEl) !== 'w:p') return;
    if (!TABLE_CAPTION_FALLBACK.test(paragraphPlainText(childEl))) return;

    let j = i + 1;
    while (j < children.length && qName(children[j]) === 'w:p' && !paragraphPlainText(children[j])) {
      j += 1;
    }
    if (j >= children.length || qName(children[j]) !== 'w:tbl') return;

    setParagraphStyle(childEl, TABLE_CAPTION_STYLE_ID);
    changed += 1;
  });
  return changed;
}

function setParagraphStyle(p: XEl, styleId: string): void {
  const doc = p.ownerDocument;
  const ppr = child(p, 'w:pPr') ?? insertEl(p, doc.createElement('w:pPr'), 0);
  ensureEl(ppr, 'w:pStyle').setAttribute('w:val', styleId);
}
