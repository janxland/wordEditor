import type { TextAlign, LineSpacing } from './types';

export interface FieldOption<T extends string | number = string> {
  label: string;
  value: T;
}

export interface FieldMeta {
  key: string;
  label: string;
  type: 'bool' | 'number' | 'select' | 'text' | 'font';
  hint?: string;
  min?: number;
  max?: number;
  options?: FieldOption<string | number>[];
}

export const ALIGN_OPTIONS: FieldOption<TextAlign>[] = [
  { label: '左对齐', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '右对齐', value: 'right' },
  { label: '两端对齐', value: 'both' },
  { label: '分散对齐', value: 'distribute' },
];

export const LINE_SPACING_OPTIONS: FieldOption<LineSpacing>[] = [
  { label: '单倍行距', value: 'single' },
  { label: '1.5 倍', value: '1.5' },
  { label: '双倍', value: 'double' },
];

export const MATCH_KIND_OPTIONS: FieldOption[] = [
  { label: '标题 (heading 1–5)', value: 'heading' },
  { label: '正文 (Normal / 文章的正文)', value: 'body' },
];

export const PARAGRAPH_FIELDS: FieldMeta[] = [
  {
    key: 'word_wrap_break_latin',
    label: '西文断行',
    type: 'bool',
    hint: '允许西文在单词中间断行，避免两端对齐大空格',
  },
  { key: 'clear_indent', label: '清除缩进', type: 'bool' },
  { key: 'indent_clear', label: '不首行缩进', type: 'bool' },
  { key: 'align', label: '对齐', type: 'select', options: ALIGN_OPTIONS },
  {
    key: 'line_spacing',
    label: '行距',
    type: 'select',
    options: LINE_SPACING_OPTIONS,
    hint: '也可在 YAML 中写数字（半磅）',
  },
  {
    key: 'spacing_before_dxa',
    label: '段前 (dxa)',
    type: 'number',
    hint: '240 = 12pt 一行',
    min: 0,
  },
  {
    key: 'spacing_after_dxa',
    label: '段后 (dxa)',
    type: 'number',
    min: 0,
  },
  {
    key: 'hanging_indent_chars',
    label: '悬挂缩进 (字符)',
    type: 'number',
    min: 0,
  },
  {
    key: 'first_line_chars',
    label: '首行缩进 (字符)',
    type: 'number',
    min: 0,
  },
];

export const RUN_FIELDS: FieldMeta[] = [
  {
    key: 'latin_font',
    label: '西文字体',
    type: 'font',
    hint: 'inherit = 使用 fonts.latin',
  },
  { key: 'cjk_font', label: '中文字体', type: 'font' },
  {
    key: 'size_half_pt',
    label: '字号 (半磅)',
    type: 'number',
    hint: '21=小四, 24=小三, 28=小二',
    min: 1,
  },
];


/** 半磅 → 常见中文字号展示 */
export function halfPtLabel(v?: number): string {
  if (v == null) return '';
  const pt = v / 2;
  const map: Record<number, string> = {
    10.5: '小四',
    12: '小三',
    14: '小二',
    10: '五号',
  };
  const name = map[pt];
  return name ? `${pt}pt (${name})` : `${pt}pt`;
}
