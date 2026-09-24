/**
 * DSL 驱动的列表样式注入（list_style_library + use_list_styles）。
 * 等价于 pipeline/ooxml_list_styles.py。
 *
 * 设计哲学（松耦合 + 高效）：
 *
 *   • 库（list_style_library）单独成 yaml，可被任意 styles.yaml 通过 `extends:` 引入
 *   • 模板用 `use_list_styles:` 声明启用哪些样式，并可单独覆盖 paragraph 字段
 *   • 元样式 ListBase 自带 0 缩进 / 无制表符 —— 派生样式只需声明编号差异
 *   • 段落属性 / run 属性的注入复用 styles-dsl（postprocess_styles）中已有的
 *     `applyParagraph` / `applyRun`，零重复实现
 *   • numId 从 100 起分配，与 multilevel_list 的低位 numId 完全隔离
 *
 * 与 multilevel 一样直接改写已解析的部件根节点，序列化由调用方（styles 阶段）统一负责。
 */
import { addEl, addElAt, attr, child, descendants, removeEl, setAttr, type XEl } from './xml.js';
import { findStyleById, pythonInt, removeChildTags } from './util.js';
import { abstractIdOfNum, addAbstractNum, appendNum, usedNumIds } from './numbering.js';
import {
  applyParagraph,
  applyRun,
  type FontsDsl,
  type LibraryItem,
  type ParagraphDsl,
  type RunDsl,
  type UseListItem,
} from './styles-dsl.js';

/** 库条目的 `list` 块（编号差异所在）。 */
type ListDsl = NonNullable<LibraryItem['list']>;

/** 库条目 flatten 后的形态：三块属性一定存在（可能是空字典）。 */
export interface FlatStyle extends Omit<LibraryItem, 'paragraph' | 'run' | 'list'> {
  paragraph: ParagraphDsl;
  run: RunDsl;
  list: ListDsl;
}

export interface ListStylesOptions {
  /** DSL 顶层 `fonts`：`latin_font: inherit` 在此解析。 */
  readonly fonts?: FontsDsl;
  readonly baseNumId?: number;
  /** 库中找不到启用项时的告警通道（默认同 Python：打到 stdout）。 */
  readonly warn?: (line: string) => void;
}

export interface RedirectOptions {
  readonly defaultIlvl?: number;
  readonly defaultStyleId?: string | null;
}

/** overrides 允许覆盖的字段：三块属性走合并，name/based_on 直接赋值。 */
const OVERRIDE_FIELDS = ['paragraph', 'run', 'list', 'name', 'based_on'] as const;

/** 无 based_on 时的空父项：等价 Python 的 `parent = {}`。 */
const EMPTY_PARENT = { paragraph: {}, run: {}, list: {} } as FlatStyle;

/**
 * 注入选中的列表样式：numbering.xml 建 abstractNum + num，styles.xml 建段落样式并挂 numPr。
 *
 * 返回 {id: numId}（便于调试输出）。useList 为空或全部未命中库 → 不动任何节点。
 */
export function applyListStyles(
  numberingRoot: XEl,
  stylesRoot: XEl,
  library: readonly LibraryItem[],
  useList: readonly UseListItem[],
  options: ListStylesOptions = {},
): Map<string, number> {
  if (!useList || useList.length === 0) return new Map();

  // 1) 解析库 + 启用项
  const items = resolveUseList(flattenLibrary(library ?? []), useList, options.warn);
  if (items.length === 0) return new Map();

  // 2) numbering.xml: 为每个启用样式创建 abstractNum + num
  const used = usedNumIds(numberingRoot);

  const newNums: Array<{ numId: number; abstractId: string }> = [];
  const usedIds = new Map<string, number>();

  let nextId = options.baseNumId ?? 100;
  for (const style of items) {
    while (used.has(nextId)) nextId += 1;
    const numId = nextId;
    nextId += 1;
    // addAbstractNum 每次取 max(abstractNumId)+1，与 Python 预先算好的 next_abs_id 递增等价。
    const ab = addAbstractNum(numberingRoot);
    fillAbstractNum(ab, style);
    newNums.push({ numId, abstractId: attr(ab, 'w:abstractNumId') ?? '' });
    used.add(numId);
    usedIds.set(style.id, numId);
  }

  for (const { numId, abstractId } of newNums) appendNum(numberingRoot, numId, abstractId);

  // 3) styles.xml: 创建段落样式 + 写 paragraph/run + 挂 numPr
  const fonts = options.fonts ?? {};
  for (const style of items) {
    const sid = style.id;
    const s = ensureStyle(stylesRoot, sid, style.name ?? sid, style.based_on || 'a');
    if ('paragraph' in style) applyParagraph(s, style.paragraph);
    if ('run' in style) applyRun(s, style.run, fonts);
    attachNumPr(s, usedIds.get(sid)!, 0);
  }

  return usedIds;
}

/**
 * 把 document.xml 中 Pandoc 散装 numId 重定向到模板默认列表样式。
 *
 * 为每个原 numId 分配一个**独立的新 numId**，都指向 `defaultNumId` 对应的
 * abstractNumId 并强制 9 级 startOverride=1 → 每个列表块从 1 重新计数。
 * 若提供 `defaultStyleId`，同时为这些段落注入 `w:pStyle`，让列表段套用
 * DSL 中定义的列表样式（如「数字列表」），从而继承基样式（如「文章的正文」）
 * 的字体/字号/行距。找不到 abstract 时退化为共享 `defaultNumId`。
 *
 * 就地改写 document / numbering，返回重写段数。
 */
export function redirectListNumIds(
  documentRoot: XEl,
  numberingRoot: XEl,
  defaultNumId: number,
  preservedNumIds: ReadonlySet<number>,
  options: RedirectOptions = {},
): number {
  const defaultIlvl = options.defaultIlvl ?? 0;
  const defaultStyleId = options.defaultStyleId ?? null;

  const targetAbs = abstractIdOfNum(numberingRoot, defaultNumId);
  const used = usedNumIds(numberingRoot);
  let nextId = Math.max(...used, defaultNumId, 199) + 1;
  const mapping = new Map<number, number>();

  const remap = (orig: number): number => {
    if (targetAbs === undefined) return defaultNumId; // 退化：无可继承的 abstract → 共享 numId
    if (!mapping.has(orig)) {
      while (used.has(nextId)) nextId += 1;
      mapping.set(orig, nextId);
      used.add(nextId);
      nextId += 1;
    }
    return mapping.get(orig)!;
  };

  let count = 0;
  for (const p of descendants(documentRoot, 'w:p')) {
    const ppr = child(p, 'w:pPr');
    if (!ppr) continue;
    const numpr = child(ppr, 'w:numPr');
    if (!numpr) continue;
    const nidEl = child(numpr, 'w:numId');
    if (!nidEl) continue;
    const cur = pythonInt(attr(nidEl, 'w:val')) ?? -1;
    if (cur <= 0 || preservedNumIds.has(cur)) continue;
    setAttr(nidEl, 'w:val', remap(cur));
    if (!child(numpr, 'w:ilvl')) setAttr(addElAt(numpr, 'w:ilvl', 0), 'w:val', defaultIlvl);
    if (defaultStyleId) {
      const ps = child(ppr, 'w:pStyle');
      if (!ps) setAttr(addElAt(ppr, 'w:pStyle', 0), 'w:val', defaultStyleId);
      else setAttr(ps, 'w:val', defaultStyleId);
    }
    count += 1;
  }

  if (count === 0) return 0;

  for (const newId of mapping.values()) {
    // 仅当 targetAbs 存在时 mapping 才非空
    const n = appendNum(numberingRoot, newId, targetAbs!);
    for (let ilvl = 0; ilvl < 9; ilvl += 1) {
      const lo = addEl(n, 'w:lvlOverride');
      setAttr(lo, 'w:ilvl', ilvl);
      setAttr(addEl(lo, 'w:startOverride'), 'w:val', 1);
    }
  }

  return count;
}

// ─────────────────────────────── 库样式扁平化 ───────────────────────────────

/**
 * 处理 based_on 继承链，返回 id -> 扁平 style。
 *
 * 继承字段：paragraph / run / list；id / name / based_on 沿用子项。
 */
export function flattenLibrary(library: readonly LibraryItem[]): Map<string, FlatStyle> {
  const idx = new Map<string, LibraryItem>();
  for (const s of library) {
    if (s && s.id) idx.set(s.id, s);
  }
  const cache = new Map<string, FlatStyle>();

  const resolve = (sid: string, chain: readonly string[] = []): FlatStyle => {
    const cached = cache.get(sid);
    if (cached) return cached;
    if (chain.includes(sid)) {
      throw new Error(`list_style_library based_on 循环: ${[...chain, sid].join(' -> ')}`);
    }
    // sid 只可能来自 idx 的键（或已校验 `in idx` 的 based_on），Python 的 None 分支不可达。
    const s = idx.get(sid)!;
    const based = s.based_on;
    // 仅当父也在库内才向上合并
    const parent: FlatStyle = based && idx.has(based) ? resolve(based, [...chain, sid]) : EMPTY_PARENT;
    const flat: FlatStyle = {
      ...deepCopy(s),
      paragraph: mergeDict<ParagraphDsl>(parent.paragraph, s.paragraph),
      run: mergeDict<RunDsl>(parent.run, s.run),
      list: mergeDict<ListDsl>(parent.list, s.list),
    };
    cache.set(sid, flat);
    return flat;
  };

  return new Map([...idx.keys()].map((sid) => [sid, resolve(sid)]));
}

/** 把模板的 use_list_styles 解析为最终样式列表（应用 overrides）。 */
export function resolveUseList(
  libraryFlat: ReadonlyMap<string, FlatStyle>,
  useList: readonly UseListItem[],
  // Python 用 print 打到 stdout；默认同样直出，阶段可换成自己的日志通道。
  warn: (line: string) => void = (line) => console.log(line),
): FlatStyle[] {
  const out: FlatStyle[] = [];
  for (const item of useList ?? []) {
    let sid: string | undefined;
    let overrides: Partial<LibraryItem> | undefined;
    if (typeof item === 'string') {
      sid = item;
    } else if (item && typeof item === 'object') {
      sid = item.id;
      overrides = item.overrides || item.override;
    } else {
      continue;
    }
    if (!sid || !libraryFlat.has(sid)) {
      warn(`  ! 列表样式库未找到: ${sid === undefined ? 'null' : `'${sid}'`}`);
      continue;
    }
    const flat: Record<string, unknown> = { ...deepCopy(libraryFlat.get(sid)!) };
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (!(OVERRIDE_FIELDS as readonly string[]).includes(key)) continue;
        flat[key] = isDict(value) ? mergeDict<Record<string, unknown>>(flat[key], value) : value;
      }
    }
    out.push(flat as unknown as FlatStyle);
  }
  return out;
}

/** 递归合并：over 覆盖 base，同名嵌套字典逐层合并（base 非字典按 {} 处理）。 */
function mergeDict<T extends object>(base: unknown, over: unknown): T {
  const out: Record<string, unknown> = {};
  Object.assign(out, isDict(base) ? base : {});
  for (const [k, v] of Object.entries(isDict(over) ? over : {})) {
    const cur = out[k];
    out[k] = isDict(v) && isDict(cur) ? mergeDict<Record<string, unknown>>(cur, v) : v;
  }
  return out as T;
}

// ─────────────────────────────── numbering.xml ───────────────────────────────

/** 从扁平 style 生成单级 abstractNum（abstractNumId 与插入位置由 numbering.ts 负责）。 */
function fillAbstractNum(ab: XEl, style: FlatStyle): void {
  setAttr(addEl(ab, 'w:multiLevelType'), 'w:val', 'hybridMultilevel');

  const lst = style.list ?? {};
  const lvl = addEl(ab, 'w:lvl');
  setAttr(lvl, 'w:ilvl', 0);
  setAttr(addEl(lvl, 'w:start'), 'w:val', Math.trunc(Number(lst.start ?? 1)));
  setAttr(addEl(lvl, 'w:numFmt'), 'w:val', String(lst.num_fmt ?? 'decimal'));
  if (lst.suff) setAttr(addEl(lvl, 'w:suff'), 'w:val', String(lst.suff));
  setAttr(addEl(lvl, 'w:lvlText'), 'w:val', String(lst.lvl_text ?? '%1.'));
  setAttr(addEl(lvl, 'w:lvlJc'), 'w:val', String(lst.align ?? 'left'));
  // pStyle 绑定到本列表样式 id，方便 Word 在更改样式时自动套
  setAttr(addEl(lvl, 'w:pStyle'), 'w:val', style.id);
}

// ─────────────────────────────── styles.xml ───────────────────────────────

/** 已有则清掉 pPr/rPr 以便重写（保留 name/basedOn/qFormat），否则新建段落样式。 */
function ensureStyle(root: XEl, sid: string, name: string, basedOn: string): XEl {
  const existing = findStyleById(root, sid);
  if (existing) {
    removeChildTags(existing, 'pPr', 'rPr');
    return existing;
  }
  const s = addEl(root, 'w:style');
  setAttr(s, 'w:type', 'paragraph');
  setAttr(s, 'w:customStyle', '1');
  setAttr(s, 'w:styleId', sid);
  setAttr(addEl(s, 'w:name'), 'w:val', name);
  setAttr(addEl(s, 'w:basedOn'), 'w:val', basedOn);
  addEl(s, 'w:qFormat');
  return s;
}

function attachNumPr(style: XEl, numId: number, ilvl: number): void {
  let ppr = child(style, 'w:pPr');
  // Python 在这里是 SubElement（追加到末尾），不是 ensurePpr 的插到首位。
  if (!ppr) ppr = addEl(style, 'w:pPr');
  // 重写 numPr
  const old = child(ppr, 'w:numPr');
  if (old) removeEl(ppr, old);
  const np = addEl(ppr, 'w:numPr');
  setAttr(addEl(np, 'w:ilvl'), 'w:val', ilvl);
  setAttr(addEl(np, 'w:numId'), 'w:val', numId);
}

// ─────────────────────────────── 小工具 ───────────────────────────────

function isDict(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `copy.deepcopy`：字典/列表递归复制，标量按 Python 一样共享引用。 */
function deepCopy<T>(value: T): T {
  return deepCopyValue(value) as T;
}

function deepCopyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => deepCopyValue(v));
  if (isDict(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepCopyValue(v);
    return out;
  }
  return value;
}
