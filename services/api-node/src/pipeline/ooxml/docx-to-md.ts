/**
 * docx → Markdown 结构还原：对应 pipeline/extract_docx_to_md.py。
 *
 * 只做 DOM → 文本，不碰 zip 与磁盘：图片由 planImages() 按 rels 顺序规划新文件名，
 * 落盘交给调用方。与 Python 一样按「样式 + 内容」双重识别标题/摘要/图注/表注，
 * 而不是把导入的 docx 直接丢给 Pandoc——学校模板里样式名才是结构的权威来源。
 */
import { attr, child, childEls, descendants, qName, textOf, type XEl } from './xml.js';

export interface ExtractStats {
  headings: number;
  images: number;
  tables: number;
  paragraphs: number;
  lists: number;
}

export interface Relation {
  id: string;
  target: string;
}

/** rels 中指向 word/media/ 的图片：rid → 导出文件名 + 原部件路径。 */
export interface ImagePlan {
  rid: string;
  /** zip 内的原始部件路径，如 `word/media/image3.png`。 */
  source: string;
  name: string;
}

export interface ExtractOutput {
  markdown: string;
  title: string | null;
  stats: ExtractStats;
}

const HEAD_PREFIX_RE =
  /^\s*(?:\d+(?:[.\uFF0E]\d+)+[.\uFF0E\s\u3001\u3000]*|\d+[.\uFF0E\u3001\u3000\s]+|[一二三四五六七八九十百零]+[、.\uFF0E\s\u3000]+|[(（]\d+[）)][\s.]*|\d+[）)][\s.]*)/;

const LIST_PREFIX_RE = /^\s*(?:[(（]\d+[）)]|\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/;

const KEYWORDS_PREFIXES = ['keywords:', 'keywords：', 'key words:'];
const CHINESE_KEYWORD_PREFIXES = ['关键词：', '关键词:', '关 键 词：'];

/** `to` / `in` 等命令后不能紧跟词字符：Python 的 `\b` 按 Unicode 判定，CJK 也算词字符。 */
const LATEX_CMD_RE =
  /\\(?:frac|int|sum|prod|sqrt|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|infty|cdot|times|quad|qquad|pm|mp|leq|geq|neq|approx|to|left|right|partial|nabla|circ|text|mathrm|begin|end)(?![\p{L}\p{N}_])/u;

const FIGURE_CAPTION_RE = /^(图\s*\d+[\s.\uFF0E：:、\u3000]*)(.*)$/;
const TABLE_CAPTION_RE = /^(表\s*\d+[\s.\uFF0E：:、\u3000]*)(.*)$/;

/** 只由标点构成的极短段（如孤立的「。」）不导出。 */
const PUNCT_ONLY_RE = /^[。\uFF01!\uFF1F?\uFF0C,\uFF1B;\uFF1A:、\s]+$/;

/** styleId -> [样式名, outlineLvl]。 */
function parseStyles(stylesRoot: XEl): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  for (const s of childEls(stylesRoot, 'w:style')) {
    const sid = attr(s, 'w:styleId') ?? '';
    const name = attr(child(s, 'w:name'), 'w:val') ?? '';
    const outline = attr(child(s, 'w:pPr/w:outlineLvl'), 'w:val') ?? '';
    out.set(sid, [name, outline]);
  }
  return out;
}

export function parseRelations(root: XEl): Relation[] {
  return childEls(root, 'Relationship')
    .map((el) => ({ id: attr(el, 'Id') ?? '', target: attr(el, 'Target') ?? '' }))
    .filter((r) => r.id && r.target);
}

/** 按 rels 出现顺序命名 image01.ext…，与 Python 的 media_index 计数一致。 */
export function planImages(rels: readonly Relation[]): ImagePlan[] {
  const plans: ImagePlan[] = [];
  let mediaIndex = 0;
  for (const { id, target } of rels) {
    if (!target.startsWith('media/')) continue;
    mediaIndex += 1;
    const ext = splitExt(target).toLowerCase() || '.png';
    plans.push({ rid: id, source: `word/${target}`, name: `image${String(mediaIndex).padStart(2, '0')}${ext}` });
  }
  return plans;
}

function splitExt(target: string): string {
  const base = target.slice(target.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

export function docxToMarkdown(input: {
  documentRoot: XEl;
  stylesRoot: XEl;
  rels: Relation[];
  /** 没有 Title 段时的兜底标题（Python 用 docx 文件名）。 */
  titleFallback: string;
  imageRel: string;
}): ExtractOutput {
  const { documentRoot, imageRel, titleFallback } = input;
  const styles = parseStyles(input.stylesRoot);
  const ridToName = new Map(planImages(input.rels).map((p) => [p.rid, p.name]));

  const out: string[] = [];
  const stats: ExtractStats = { headings: 0, images: 0, tables: 0, paragraphs: 0, lists: 0 };
  let title: string | null = null;
  let pendingTableCaption: string | null = null;

  const children = childEls(child(documentRoot, 'w:body') ?? documentRoot);
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    i += 1;

    if (qName(node) === 'w:tbl') {
      const mdTable = tableToMarkdown(node);
      if (pendingTableCaption) {
        out.push(mdTable, `\nTable: ${pendingTableCaption}\n`);
        pendingTableCaption = null;
      } else {
        out.push(`${mdTable}\n`);
      }
      stats.tables += 1;
      continue;
    }
    if (qName(node) !== 'w:p') continue;

    const sid = attr(child(node, 'w:pPr/w:pStyle'), 'w:val') ?? '';
    const [name, outline] = styles.get(sid) ?? ['', ''];
    const text = normalizeText(collectText(node));
    const rids = collectImageRids(node);

    if (rids.length) {
      for (const rid of rids) {
        const fname = ridToName.get(rid);
        if (!fname) continue;
        out.push(`![](${imageRel.replace(/\\/g, '/')}/${fname})\n`);
        stats.images += 1;
      }
      // 少见：图片段里还带着文字，继续按下面的分支走。
      if (!text) continue;
    }

    if (title === null && (sid === 'a3' || name.toLowerCase() === 'title') && text) {
      title = text;
      continue;
    }
    if (!text) continue;

    if (text === '摘要') {
      out.push('\n摘要\n');
      continue;
    }
    if (text === 'Abstract') {
      out.push('\nAbstract\n');
      continue;
    }
    if (CHINESE_KEYWORD_PREFIXES.some((p) => text.startsWith(p))) {
      out.push(`\n**关键词**：${text.replace(/^关\s*键\s*词\s*[:：]\s*/, '')}\n`);
      continue;
    }
    if (KEYWORDS_PREFIXES.some((p) => text.toLowerCase().startsWith(p))) {
      out.push(`\n**Keywords**: ${text.replace(/^[Kk]ey\s*[Ww]ords\s*[:：]\s*/, '')}\n`);
      continue;
    }

    const figure = FIGURE_CAPTION_RE.exec(text);
    if (figure && out.length && out[out.length - 1].startsWith('![')) {
      const cap = figure[2].trim() || figure[1].trim();
      const last = out[out.length - 1].replace(/\n+$/, '');
      const at = last.indexOf('![]');
      // 图注回填进 alt 文本；用切片而不是 replace，避免题注里的 `$&` 被当成替换模式。
      out[out.length - 1] =
        at >= 0 ? `${last.slice(0, at)}![${cap}]${last.slice(at + 3)}\n` : `${last}\n`;
      continue;
    }
    const tableCaption = TABLE_CAPTION_RE.exec(text);
    if (tableCaption) {
      let j = i;
      while (j < children.length && qName(children[j]) !== 'w:tbl' && qName(children[j]) !== 'w:p') {
        j += 1;
      }
      if (j < children.length && qName(children[j]) === 'w:tbl') {
        pendingTableCaption = tableCaption[2].trim() || tableCaption[1].trim();
        continue;
      }
    }

    const level = headingLevel(sid, name, outline);
    if (level >= 1) {
      const clean = stripHeadingPrefix(text);
      if (clean) {
        out.push(`\n${'#'.repeat(level)} ${clean}\n`);
        stats.headings += 1;
        continue;
      }
    }

    if (isListParagraph(name, text)) {
      out.push(`- ${text.replace(LIST_PREFIX_RE, '')}`);
      stats.lists += 1;
      continue;
    }

    if (looksLikePureLatex(text)) {
      out.push(`$$\n${text}\n$$`);
      stats.paragraphs += 1;
      continue;
    }

    if (text.length <= 2 && PUNCT_ONLY_RE.test(text)) continue;

    out.push(text);
    stats.paragraphs += 1;
  }

  return {
    markdown: `---\ntitle: ${title ?? titleFallback}\n---\n${out.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`,
    title,
    stats,
  };
}

// ─────────────────────────────── 段落文本 ───────────────────────────────

/**
 * 段落文本：w:t 直取，w:tab/w:br 留白；oMath 块内的 m:t 合并成 `$…$` 占位，便于人工修 LaTeX。
 */
function collectText(el: XEl): string {
  const parts: string[] = [];

  const walk = (node: XEl): void => {
    const tag = qName(node);
    if (tag === 'm:oMath' || tag === 'm:oMathPara') {
      const inner = descendants(node, 'm:t').map((t) => textOf(t)).join('');
      if (inner.trim()) parts.push(` $${inner}$ `);
      return;
    }
    if (tag === 'w:t') {
      if (node.childNodes.length) parts.push(textOf(node));
    } else if (tag === 'w:tab') {
      parts.push('\t');
    } else if (tag === 'w:br') {
      parts.push('\n');
    }
    for (const c of childEls(node)) walk(c);
  };

  walk(el);
  return parts.join('');
}

/** 关系命名空间的前缀在不同文档里不固定（r / ocr / …），按本地名取属性。 */
function relAttr(el: XEl, local: string): string | undefined {
  for (let n = 0; n < el.attributes.length; n += 1) {
    const a = el.attributes.item(n)!;
    const name = a.localName || a.name.split(':').pop()!;
    if (name === local && a.value) return a.value;
  }
  return undefined;
}

function collectImageRids(el: XEl): string[] {
  const rids: string[] = [];
  for (const blip of descendants(el, 'a:blip')) {
    const rid = relAttr(blip, 'embed') ?? relAttr(blip, 'link');
    if (rid) rids.push(rid);
  }
  return rids;
}

/** 归并段内空白；数学块的空格已在 `$…$` 内，不受影响。 */
function normalizeText(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function looksLikePureLatex(text: string): boolean {
  if (!text || text.length > 240) return false;
  if (!LATEX_CMD_RE.test(text)) return false;
  return !/[\u4e00-\u9fff]{10,}/.test(text);
}

/** 只有样式名/样式 id 明确是 heading 才算标题，避免带 outlineLvl 的正文样式被误判。 */
function headingLevel(sid: string, name: string, outline: string): number {
  const lowerName = name.toLowerCase();
  const lowerId = sid.toLowerCase();
  if (lowerId === 'a3' || lowerName === 'title') return 0;
  if (!lowerName.startsWith('heading ') && !lowerId.startsWith('heading')) return 0;
  if (lowerName.startsWith('heading ')) {
    const token = lowerName.split(' ')[1] ?? '';
    if (/^\d+$/.test(token)) return Math.max(1, Math.min(6, Number(token)));
  }
  if (/^\d+$/.test(outline)) {
    const value = Number(outline);
    if (value <= 5) return value + 1;
  }
  return 0;
}

function stripHeadingPrefix(text: string): string {
  return text.replace(HEAD_PREFIX_RE, '').trim();
}

function isListParagraph(name: string, text: string): boolean {
  if (name.toLowerCase() === 'list paragraph') return true;
  return LIST_PREFIX_RE.test(text);
}

// ─────────────────────────────── 表格 ───────────────────────────────

function tableToMarkdown(tbl: XEl): string {
  const rows: string[][] = [];
  for (const tr of childEls(tbl, 'w:tr')) {
    const cells: string[] = [];
    for (const tc of childEls(tr, 'w:tc')) {
      const cell = childEls(tc, 'w:p')
        .map((p) => normalizeText(collectText(p)))
        .filter(Boolean)
        .join(' <br> ')
        .trim();
      cells.push(cell || ' ');
    }
    rows.push(cells);
  }
  if (!rows.length) return '';

  const width = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push(' ');

  const lines = [`| ${rows[0].join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const r of rows.slice(1)) lines.push(`| ${r.map((c) => c.replace('|', '\\|')).join(' | ')} |`);
  return lines.join('\n');
}
