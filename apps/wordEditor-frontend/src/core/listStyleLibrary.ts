/** 内置列表样式库（与 templates/_shared/list-style-library.yaml 镜像）
 *
 * 用途：前端无代码可视化兜底 —— 当模板的 styles.yaml 未直接声明
 * list_style_library（绝大多数模板只 extends hutb-base.yaml），前端
 * 用本常量展示样式池，用户勾选启用即写入 use_list_styles。
 *
 * 后端构建时 postprocess_styles.load_dsl 会展开 extends 链拿到真实库，
 * 因此 use_list_styles 在 yaml 中只需简单引用 id，零冗余。
 */
import type { ListStyleLibraryItem } from '@/core/types';

export const BUILTIN_LIST_STYLE_LIBRARY: ListStyleLibraryItem[] = [
  {
    id: 'ListBase',
    name: '列表基样式',
    based_on: 'a',
    description: '元样式：0 缩进 + 无制表符 + 单倍行距。其它列表样式以此为基。',
    paragraph: {
      align: 'both',
      line_spacing: 'single',
      spacing_before_dxa: 0,
      spacing_after_dxa: 0,
      indent_clear: true,
      first_line_chars: 0,
      hanging_indent_chars: 0,
    },
    run: { latin_font: 'inherit', size_half_pt: 24 },
    list: { num_fmt: 'none', lvl_text: '', suff: 'nothing' },
  },
  {
    id: 'DecimalList',
    name: '数字列表（无首行缩进）',
    based_on: 'ListBase',
    description: '1. 2. 3. 编号；首行无缩进，编号后空格分隔。',
    list: { num_fmt: 'decimal', lvl_text: '%1.', suff: 'space', start: 1 },
  },
  {
    id: 'BulletList',
    name: '项目符号列表（无首行缩进）',
    based_on: 'ListBase',
    description: '● 圆点；首行无缩进。',
    list: { num_fmt: 'bullet', lvl_text: '●', suff: 'space' },
  },
  {
    id: 'ParenDecimalList',
    name: '(1)(2) 数字列表',
    based_on: 'ListBase',
    description: '(1)(2) 编号；常用于二级要点。',
    list: { num_fmt: 'decimal', lvl_text: '(%1)', suff: 'space', start: 1 },
  },
  {
    id: 'CircledList',
    name: '①②③ 圈号列表',
    based_on: 'ListBase',
    description: '圈号编号；常用于三级要点。',
    list: { num_fmt: 'decimalEnclosedCircle', lvl_text: '%1', suff: 'space', start: 1 },
  },
  {
    id: 'ChineseList',
    name: '中文一、二、三 列表',
    based_on: 'ListBase',
    description: '中文计数 + 顿号；常用于章节内要点。',
    list: { num_fmt: 'chineseCounting', lvl_text: '%1、', suff: 'nothing', start: 1 },
  },
  {
    id: 'UpperLetterList',
    name: 'A B C 字母列表',
    based_on: 'ListBase',
    list: { num_fmt: 'upperLetter', lvl_text: '%1.', suff: 'space', start: 1 },
  },
  {
    id: 'LowerLetterList',
    name: 'a b c 字母列表',
    based_on: 'ListBase',
    list: { num_fmt: 'lowerLetter', lvl_text: '%1.', suff: 'space', start: 1 },
  },
  // ── 自定义 bullet 列表（与 _shared/list-style-library.yaml 后段镜像）──
  ...(
    [
      ['StarSolidList', '★ 实心五角星列表', '★'],
      ['StarOutlineList', '☆ 空心五角星列表', '☆'],
      ['TriangleRightList', '▶ 三角列表', '▶'],
      ['DiamondSolidList', '◆ 实心菱形列表', '◆'],
      ['DiamondOutlineList', '◇ 空心菱形列表', '◇'],
      ['ChevronRightList', '› 尖括号列表', '›'],
      ['CircleOutlineList', '○ 空心圆列表', '○'],
      ['SquareOutlineList', '□ 空心方块列表', '□'],
      ['HeartOutlineList', '♡ 空心爱心列表', '♡'],
      ['HeartSolidList', '♥ 实心爱心列表', '♥'],
      ['HashList', '# 井号列表', '#'],
      ['CrownList', '♛ 皇冠列表', '♛'],
      ['PinList', '📍 定位列表', '📍'],
      ['FlowerList', '✿ 花朵列表', '✿'],
      ['AsteriskList', '✱ 星号列表', '✱'],
      ['DashList', '— 长破折号列表', '—'],
      ['CheckList', '✓ 对勾列表', '✓'],
      ['ArrowRightList', '→ 箭头列表', '→'],
    ] as const
  ).map<ListStyleLibraryItem>(([id, name, sym]) => ({
    id,
    name,
    based_on: 'ListBase',
    list: { num_fmt: 'bullet', lvl_text: sym, suff: 'space' },
  })),
];

/** 一键启用的默认 5 款（与 hutb-base.yaml 一致） */
export const DEFAULT_ENABLED_LIST_STYLES = [
  'DecimalList',
  'BulletList',
  'ParenDecimalList',
  'CircledList',
  'ChineseList',
];
