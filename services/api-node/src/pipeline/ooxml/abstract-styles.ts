/**
 * 摘要 / Abstract / 关键词段落注入样式：等价于 postprocess_styles.py 的 apply_abstract_styles。
 *
 * Pandoc 只会产出 Heading/Body，学校模板要求的「摘要标题 / 摘要 / 关键词」等专属样式
 * 必须靠正文文本特征事后识别（与 lua 过滤器的判定保持一致）。
 */
import { addEl, addElAt, attr, child, childEls, descendants, textOf, type XEl } from './xml.js';
import type { CustomStyleRule } from './styles-dsl.js';

const CN_ABSTRACT_TITLE_RE = /^\s*\[?内容摘要\]?\s*$|^\s*\[?摘\s+要\]?\s*$/;
const EN_ABSTRACT_TITLE_RE = /^\s*\[?Abstract\]?\s*$/i;
/** 标签与正文同行的写法（`[内容摘要] ×××`）；与标题式正则互斥（后者要求行尾）。 */
const CN_ABSTRACT_INLINE_RE = /^\s*\[?内容摘要\]?\s*[:：]?\s*\S|^\s*\[?摘\s*要\]?\s*[:：]\s*\S/;
const EN_ABSTRACT_INLINE_RE = /^\s*\[?abstract\]?\s*[:：]?\s*\S/i;
const CN_KEYWORDS_RE = /^\s*\[?关键词\]?\s*(?:[:：]|$|\S)/;
const EN_KEYWORDS_RE = /^\s*\[?(?:key\s*words?|keywords?)\]?\s*(?:[:：]|$|\S)/i;
/** 章节标题（用于终止摘要状态） */
const SECTION_RE =
  /^\s*[\u4e00-\u9fff]{1,3}、\s|^\s*\d+\.\d+\s|^\s*\d+\s+(?!\d)/;
/** 参考文献条目必须含数字，避免把 [Abstract] 这类英文标签误判成文献。 */
const REF_RE = /\[(?=[^\]]*\d)[\dA-Za-z]+\]/;
const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** DSL 未覆盖时使用的默认 styleId（与 build.py / lua 侧约定一致）。 */
export const ABSTRACT_STYLE_IDS = {
  abstract: 'ZhaiYao',
  abstractTitle: 'ZhaiYaoTitle',
  // 英文摘要/关键词沿用「文章的正文」样式（ae），而非独立样式
  enAbstract: 'ae',
  enAbstractTitle: 'ae',
  keywords: 'KeyWordsZh',
  enKeywords: 'ae',
} as const;

export type AbstractStyleIds = Partial<Record<keyof typeof ABSTRACT_STYLE_IDS, string>>;

/** 段落纯文本（忽略域代码，只取 w:t 的正文）。 */
function paragraphText(p: XEl): string {
  return descendants(p, 'w:t').map(textOf).join('');
}

function styleIdIndex(stylesRoot: XEl): Map<string, string> {
  const idx = new Map<string, string>();
  for (const st of childEls(stylesRoot, 'w:style')) {
    const sid = attr(st, 'w:styleId');
    const name = attr(child(st, 'w:name'), 'w:val');
    if (sid && name && !idx.has(name)) idx.set(name, sid);
  }
  return idx;
}

/**
 * 把 DSL 里的 style id 解析成 styles.xml 中真实存在的 styleId。
 * 有些 reference.docx 自带同名样式且 styleId 是中文（如「摘要」），此时 DSL 的
 * ZhaiYao 在文档里并不存在；直接写进 pStyle 会让 Word 退回 Normal，摘要排版丢失。
 */
export function resolveStyleId(
  stylesRoot: XEl,
  wanted: string,
  aliasName?: string,
): string {
  if (!wanted) return wanted;
  const ids = new Set(
    childEls(stylesRoot, 'w:style').map((s) => attr(s, 'w:styleId') ?? ''),
  );
  if (ids.has(wanted)) return wanted;
  for (const cand of [aliasName, wanted]) {
    if (cand && ids.has(cand)) return cand;
  }
  const byName = styleIdIndex(stylesRoot);
  for (const cand of [aliasName, wanted]) {
    if (cand && byName.has(cand)) return byName.get(cand)!;
  }
  return wanted;
}

function setParagraphStyleId(p: XEl, styleId: string): void {
  const ppr = child(p, 'w:pPr') ?? addElAt(p, 'w:pPr', 0);
  const ps = child(ppr, 'w:pStyle') ?? addEl(ppr, 'w:pStyle');
  ps.setAttribute('w:val', styleId);
}

/**
 * 识别中文摘要 / Abstract / 关键词段落并注入对应样式（就地修改 document root）。
 *
 * - 裸文字 `[内容摘要]` / `内容摘要` → 摘要标题
 * - 裸文字 `[Abstract]` → 英文摘要标题（「文章的正文」样式）
 * - 关键词/Keywords 行 → 中文用独立样式，英文用「文章的正文」
 * - 摘要状态内的纯英文段落 → 「文章的正文」；中文段落 → 摘要
 * - 遇到章节标题（一、/ 1. / 1.1）或参考文献条目终止状态
 */
export function applyAbstractStyles(
  documentRoot: XEl,
  stylesRoot: XEl,
  options: { styleIds?: AbstractStyleIds; customStyles?: CustomStyleRule[] } = {},
): number {
  const body = child(documentRoot, 'w:body') ?? documentRoot;
  // 与 Python 的字典推导一致：同 id 后声明者胜出
  const aliases = new Map<string, string>();
  for (const c of options.customStyles ?? []) {
    if (c.id) aliases.set(c.id, c.name);
  }

  const wanted = { ...ABSTRACT_STYLE_IDS, ...options.styleIds };
  const ids = Object.fromEntries(
    Object.entries(wanted).map(([key, value]) => [
      key,
      resolveStyleId(stylesRoot, value, aliases.get(value)),
    ]),
  ) as typeof wanted;

  let inCnAbstract = false;
  let inEnAbstract = false;
  let changed = 0;

  for (const p of childEls(body, 'w:p')) {
    const text = paragraphText(p).trim();

    if (REF_RE.test(text)) {
      inCnAbstract = false;
      inEnAbstract = false;
      continue;
    }
    if (SECTION_RE.test(text)) {
      inCnAbstract = false;
      inEnAbstract = false;
      continue;
    }
    if (!text) continue;

    if (CN_ABSTRACT_TITLE_RE.test(text)) {
      inCnAbstract = true;
      inEnAbstract = false;
      setParagraphStyleId(p, ids.abstractTitle);
      changed += 1;
      continue;
    }
    if (EN_ABSTRACT_TITLE_RE.test(text)) {
      inEnAbstract = true;
      inCnAbstract = false;
      setParagraphStyleId(p, ids.enAbstractTitle);
      changed += 1;
      continue;
    }
    if (CN_ABSTRACT_INLINE_RE.test(text)) {
      inCnAbstract = false;
      inEnAbstract = false;
      setParagraphStyleId(p, ids.abstract);
      changed += 1;
      continue;
    }
    // 标签与正文同行：其后仍可能有纯英文摘要正文段，保持状态
    if (EN_ABSTRACT_INLINE_RE.test(text)) {
      inCnAbstract = false;
      inEnAbstract = true;
      setParagraphStyleId(p, ids.enAbstract);
      changed += 1;
      continue;
    }
    if (CN_KEYWORDS_RE.test(text)) {
      inCnAbstract = false;
      inEnAbstract = false;
      setParagraphStyleId(p, ids.keywords);
      changed += 1;
      continue;
    }
    if (EN_KEYWORDS_RE.test(text)) {
      inCnAbstract = false;
      inEnAbstract = false;
      setParagraphStyleId(p, ids.enKeywords);
      changed += 1;
      continue;
    }
    if (inCnAbstract) {
      setParagraphStyleId(p, ids.abstract);
      changed += 1;
      continue;
    }
    if (inEnAbstract) {
      // 含中文则退出状态，避免误标后续正文
      if (!CJK_RE.test(text)) {
        setParagraphStyleId(p, ids.enAbstract);
        changed += 1;
      } else {
        inEnAbstract = false;
      }
    }
  }
  return changed;
}
