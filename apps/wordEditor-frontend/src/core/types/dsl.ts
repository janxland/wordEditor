/** 涓?docs/styles-dsl.md 瀵归綈鐨?YAML DSL 缁撴瀯 */

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

/** 澶氱骇鍒楄〃鍗曠骇锛堝榻?services/api-python/pipeline/ooxml_multilevel.py 鐨?spec.levels[i]锛?*/
export interface MultilevelLevel {
  /** ilvl: 0=H1 / 1=H2 / 2=H3 / 3=H4 */
  ilvl: number;
  /** 缁戝畾鐨?Heading styleId锛堜笌 Pandoc 杈撳嚭涓€鑷达細"1"/"2"/"3"/"4"锛?*/
  heading_style?: string;
  /** OOXML numFmt锛歝hineseCounting / decimal / decimalEnclosedCircle / upperRoman 绛?*/
  num_fmt: string;
  /** 缂栧彿鏄剧ず妯℃澘锛屼緥濡?"%1銆? / "%1.%2" / "绗?1绔? */
  lvl_text: string;
  /** 缂栧彿鍚庣殑鍒嗛殧锛歴pace / tab / nothing */
  suff?: 'space' | 'tab' | 'nothing';
  /** 璧峰鍙凤紙榛樿 1锛?*/
  start?: number;
  /** 鎶婁笂绾т腑鏂?缃楅┈鏁板瓧涔熸寜 1,2,3 鏄剧ず鈥斺€斿绾?1.1 蹇呭 */
  is_lgl?: boolean;
  /** 瀵归綈锛歭eft / center / right */
  align?: 'left' | 'center' | 'right';
}

/** 澶氱骇鍒楄〃 DSL */
export interface MultilevelList {
  /** 鍏宠仈鍒?word/numbering.xml 涓殑 numId锛堥粯璁?2锛?*/
  num_id: number;
  levels: MultilevelLevel[];
}

/** 鍒楄〃鏍峰紡搴撶殑涓€鏉℃牱寮忥紙list_style_library 鍏冪礌 / use_list_styles 瑙ｆ瀽缁撴灉锛?*/
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

/** 妯℃澘瀵瑰簱鏍峰紡鐨勫惎鐢ㄩ」锛涘彲甯?overrides 瑕嗙洊娈佃惤/瀛椾綋 */
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
  /** 鏉ヨ嚜 _shared/list-style-library.yaml 鐨勯璁炬牱寮忔睜 */
  list_style_library?: ListStyleLibraryItem[];
  /** 鏈ā鏉垮惎鐢ㄧ殑鍒楄〃鏍峰紡锛堝甫鍙€夎鐩栵級 */
  use_list_styles?: UseListStyleItem[];
}

