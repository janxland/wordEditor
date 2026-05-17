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

export interface DslDocument {
  template: { id: string; name: string };
  fonts: DslFonts;
  overrides: StyleOverride[];
  custom_styles: CustomStyle[];
  semantics?: Record<string, unknown>;
  headings?: HeadingRule[];
}
