/** 与 docs/styles-dsl.md 对齐的 YAML DSL 结构 */

export type TextAlign = 'left' | 'center' | 'right' | 'both' | 'distribute';
export type LineSpacing = 'single' | '1.5' | 'double' | number;
export type MatchKind = 'heading' | 'body';

export interface StyleMatch {
  id?: string;
  name?: string;
  name_regex?: string;
  kind?: MatchKind;
}

export interface ParagraphProps {
  word_wrap_break_latin?: boolean;
  clear_indent?: boolean;
  indent_clear?: boolean;
  align?: TextAlign;
  line_spacing?: LineSpacing;
  spacing_before_dxa?: number;
  spacing_after_dxa?: number;
  hanging_indent_chars?: number;
  first_line_chars?: number;
}

export interface RunProps {
  latin_font?: string | 'inherit';
  cjk_font?: string | 'inherit' | null;
  size_half_pt?: number;
}

export interface StyleOverride {
  match: StyleMatch;
  word_wrap_break_latin?: boolean;
  clear_indent?: boolean;
  indent_clear?: boolean;
  latin_font?: string | 'inherit';
  cjk_font?: string | 'inherit' | null;
  paragraph?: ParagraphProps;
  run?: RunProps;
}

export interface CustomStyle {
  id: string;
  name: string;
  based_on?: string;
  paragraph?: ParagraphProps;
  run?: RunProps;
}

export interface DslFonts {
  latin?: string;
  cjk?: string | null;
}

export interface HeadingRule {
  pattern: string;
  level: number;
}

/** 多级列表单级（对齐 scripts/ooxml_multilevel.py 的 spec.levels[i]） */
export interface MultilevelLevel {
  /** ilvl: 0=H1 / 1=H2 / 2=H3 / 3=H4 */
  ilvl: number;
  /** 绑定的 Heading styleId（与 Pandoc 输出一致："1"/"2"/"3"/"4"） */
  heading_style?: string;
  /** OOXML numFmt：chineseCounting / decimal / decimalEnclosedCircle / upperRoman 等 */
  num_fmt: string;
  /** 编号显示模板，例如 "%1、" / "%1.%2" / "第%1章" */
  lvl_text: string;
  /** 编号后的分隔：space / tab / nothing */
  suff?: 'space' | 'tab' | 'nothing';
  /** 起始号（默认 1） */
  start?: number;
  /** 把上级中文/罗马数字也按 1,2,3 显示——多级 1.1 必备 */
  is_lgl?: boolean;
  /** 对齐：left / center / right */
  align?: 'left' | 'center' | 'right';
}

/** 多级列表 DSL */
export interface MultilevelList {
  /** 关联到 word/numbering.xml 中的 numId（默认 2） */
  num_id: number;
  levels: MultilevelLevel[];
}

/** 列表样式库的一条样式（list_style_library 元素 / use_list_styles 解析结果） */
export interface ListStyleNumbering {
  num_fmt: string;
  lvl_text: string;
  suff?: 'space' | 'tab' | 'nothing';
  start?: number;
  align?: 'left' | 'center' | 'right';
}

export interface ListStyleLibraryItem {
  id: string;
  name: string;
  based_on?: string;
  description?: string;
  paragraph?: ParagraphProps;
  run?: RunProps;
  list?: ListStyleNumbering;
}

/** 模板对库样式的启用项；可带 overrides 覆盖段落/字体 */
export interface UseListStyleItem {
  id: string;
  overrides?: {
    paragraph?: ParagraphProps;
    run?: RunProps;
    list?: Partial<ListStyleNumbering>;
  };
}

export interface DslDocument {
  template: { id: string; name: string };
  fonts: DslFonts;
  overrides: StyleOverride[];
  custom_styles: CustomStyle[];
  semantics?: Record<string, unknown>;
  headings?: HeadingRule[];
  multilevel_list?: MultilevelList;
  /** 来自 _shared/list-style-library.yaml 的预设样式池 */
  list_style_library?: ListStyleLibraryItem[];
  /** 本模板启用的列表样式（带可选覆盖） */
  use_list_styles?: UseListStyleItem[];
}
