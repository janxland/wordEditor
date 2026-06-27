import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  InputNumber,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  RetweetOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type {
  DslDocument,
  MultilevelLevel,
  MultilevelList,
  ParagraphProps,
  RunProps,
} from '@/core/types';

const { Text } = Typography;

/* ───────────── 默认值（与 hutb-gongke / hutb-guanke 的 multilevel_list 规范一致）
 *  工科/管科通用默认值：
 *    H1 = 四号黑体 bold，单倍行距，居左
 *    H2/H3/H4 = 小四(24)宋体 bold，单倍行距，居左，首行缩进2字符
───────────── */

const HUTB_DEFAULT: MultilevelList = {
  num_id: 2,
  levels: [
    {
      ilvl: 0, heading_style: '1', num_fmt: 'chineseCounting', lvl_text: '%1、', suff: 'nothing', start: 1,
      run: { cjk_font: '黑体', size_half_pt: 28, size_cs_half_pt: 28, bold: true },
      paragraph: { align: 'left', line_spacing: 'single', first_line_chars: 0, spacing_before_dxa: 0, spacing_after_dxa: 0 },
    },
    {
      ilvl: 1, heading_style: '2', num_fmt: 'chineseCounting', lvl_text: '（%2）', suff: 'nothing', start: 1,
      run: { cjk_font: '宋体', size_half_pt: 24, size_cs_half_pt: 24, bold: true },
      paragraph: { align: 'left', line_spacing: 'single', first_line_chars: 2, spacing_before_dxa: 0, spacing_after_dxa: 0 },
    },
    {
      ilvl: 2, heading_style: '3', num_fmt: 'decimalEnclosedCircle', lvl_text: '%3.', suff: 'space', start: 1,
      run: { cjk_font: '宋体', size_half_pt: 24, size_cs_half_pt: 24, bold: true },
      paragraph: { align: 'left', line_spacing: 'single', first_line_chars: 2, spacing_before_dxa: 0, spacing_after_dxa: 0 },
    },
    {
      ilvl: 3, heading_style: '4', num_fmt: 'decimal', lvl_text: '%3.%4', suff: 'space', start: 1,
      run: { cjk_font: '宋体', size_half_pt: 24, size_cs_half_pt: 24, bold: true },
      paragraph: { align: 'left', line_spacing: 'single', first_line_chars: 2, spacing_before_dxa: 0, spacing_after_dxa: 0 },
    },
  ],
};

/* ───────────── 常用中文字体选项 ───────────── */

const CJK_FONT_OPTIONS = [
  { label: '宋体', value: '宋体' },
  { label: '黑体', value: '黑体' },
  { label: '仿宋', value: '仿宋' },
  { label: '楷体', value: '楷体' },
  { label: '微软雅黑', value: '微软雅黑' },
];

/* ───────────── 常用西文字体选项 ───────────── */

const LATIN_FONT_OPTIONS = [
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Calibri', value: 'Calibri' },
  { label: '等宽 (Courier New)', value: 'Courier New' },
];

/* ───────────── 常用字号选项（半磅单位） ───────────── */

const SIZE_OPTIONS = [
  { label: '一号 (52)', value: 52 },
  { label: '小一 (48)', value: 48 },
  { label: '二号 (32)', value: 32 },
  { label: '小二 (28)', value: 28 },
  { label: '三号 (30)', value: 30 },
  { label: '小三 (24)', value: 24 },
  { label: '四号 (28)', value: 28 },
  { label: '小四 (21)', value: 21 },
  { label: '五号 (21)', value: 21 },
  { label: '小五 (18)', value: 18 },
  { label: '六号 (16)', value: 16 },
  { label: '自定义...', value: -1 },
];

/* ───────────── OOXML numFmt 选项（常用集） ───────────── */

const NUM_FMT_OPTIONS = [
  { label: '阿拉伯数字 1, 2, 3', value: 'decimal' },
  { label: '中文计数 一, 二, 三', value: 'chineseCounting' },
  { label: '中文带「第」第一,第二', value: 'chineseCountingThousand' },
  { label: '大写中文 壹, 贰, 叁', value: 'chineseLegalSimplified' },
  { label: '大写罗马 I, II, III', value: 'upperRoman' },
  { label: '小写罗马 i, ii, iii', value: 'lowerRoman' },
  { label: '大写字母 A, B, C', value: 'upperLetter' },
  { label: '小写字母 a, b, c', value: 'lowerLetter' },
  { label: '带圆圈 ①②③', value: 'decimalEnclosedCircle' },
  { label: '无编号 (none)', value: 'none' },
];

const SUFF_OPTIONS = [
  { label: '空格', value: 'space' },
  { label: '制表符', value: 'tab' },
  { label: '无（与文本连排）', value: 'nothing' },
];

const HEADING_STYLE_OPTIONS = [
  { label: 'Heading 1 (styleId="1")', value: '1' },
  { label: 'Heading 2 (styleId="2")', value: '2' },
  { label: 'Heading 3 (styleId="3")', value: '3' },
  { label: 'Heading 4 (styleId="4")', value: '4' },
  { label: 'Heading 5 (styleId="5")', value: '5' },
];

const LINE_SPACING_OPTIONS = [
  { label: '单倍', value: 'single' },
  { label: '1.5 倍', value: '1.5' },
  { label: '双倍', value: 'double' },
  { label: '自定义 pt...', value: 'custom' },
];

/* ───────────── 预览：把 %1 %2 渲染成示例编号 ───────────── */

const CN_DIGITS = '〇一二三四五六七八九';
function cnNumber(n: number): string {
  if (n < 10) return CN_DIGITS[n] || String(n);
  if (n < 20) return '十' + (n === 10 ? '' : CN_DIGITS[n - 10]);
  const t = Math.floor(n / 10);
  const o = n % 10;
  return CN_DIGITS[t] + '十' + (o === 0 ? '' : CN_DIGITS[o]);
}
function upperRoman(n: number): string {
  const map: [number, string][] = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '', v = n;
  for (const [k, t] of map) while (v >= k) { s += t; v -= k; }
  return s || String(n);
}
function fmtNumber(fmt: string, n: number): string {
  switch (fmt) {
    case 'chineseCounting':
    case 'chineseCountingThousand':
      return cnNumber(n);
    case 'chineseLegalSimplified':
      return ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'][n] || String(n);
    case 'upperRoman':
      return upperRoman(n);
    case 'lowerRoman':
      return upperRoman(n).toLowerCase();
    case 'upperLetter':
      return String.fromCharCode(64 + n);
    case 'lowerLetter':
      return String.fromCharCode(96 + n);
    case 'decimalEnclosedCircle':
      return '①②③④⑤⑥⑦⑧⑨⑩'[n - 1] || `(${n})`;
    case 'none':
      return '';
    default:
      return String(n);
  }
}

/** 计算第 ilvl 级第 idx 个示例编号文字（counters 长度 ≥ 当前 ilvl+1）。
 *  is_lgl=true 时把上级强制按 decimal 显示（OOXML isLgl 语义）。 */
function previewText(levels: MultilevelLevel[], ilvl: number, counters: number[]): string {
  const lvl = levels[ilvl];
  if (!lvl) return '';
  return lvl.lvl_text.replace(/%([1-9])/g, (_, d) => {
    const refIdx = Number(d) - 1;
    if (refIdx > ilvl) return '';
    const cnt = counters[refIdx] ?? 1;
    if (refIdx < ilvl && lvl.is_lgl) return String(cnt);
    const refFmt = levels[refIdx]?.num_fmt ?? 'decimal';
    return fmtNumber(refFmt, cnt);
  });
}

/* ───────────── 单级样式设置面板 ───────────── */

interface LevelStylePanelProps {
  lvl: MultilevelLevel;
  idx: number;
  onChange: (patch: Partial<MultilevelLevel>) => void;
}

const LevelStylePanel: React.FC<LevelStylePanelProps> = ({ lvl, idx, onChange }) => {
  const paragraph = lvl.paragraph ?? {};
  const run = lvl.run ?? {};

  const setParagraph = (patch: Partial<ParagraphProps>) => {
    onChange({
      paragraph: { ...paragraph, ...patch },
    });
  };

  const setRun = (patch: Partial<RunProps>) => {
    onChange({
      run: { ...run, ...patch },
    });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 字体设置 */}
      <Row gutter={[12, 8]}>
        <Col span={8}>
          <Text type="secondary">中文字体</Text>
          <Select
            allowClear
            placeholder="继承模板默认"
            style={{ width: '100%' }}
            value={run.cjk_font}
            options={CJK_FONT_OPTIONS}
            onChange={(v) => setRun({ cjk_font: v ?? undefined })}
          />
        </Col>
        <Col span={8}>
          <Text type="secondary">西文字体</Text>
          <Select
            allowClear
            placeholder="继承模板默认"
            style={{ width: '100%' }}
            value={run.latin_font}
            options={LATIN_FONT_OPTIONS}
            onChange={(v) => setRun({ latin_font: v ?? undefined })}
          />
        </Col>
        <Col span={8}>
          <Text type="secondary">字号（半磅）</Text>
          <Select
            style={{ width: '100%' }}
            value={run.size_half_pt}
            options={SIZE_OPTIONS}
            onChange={(v) => {
              if (v === -1) return;
              setRun({ size_half_pt: v ?? undefined });
            }}
          />
        </Col>
      </Row>
      {run.size_half_pt && (
        <Row gutter={[12, 8]}>
          <Col span={8}>
            <Text type="secondary">字号自定义（半磅）</Text>
            <InputNumber
              style={{ width: '100%' }}
              min={8}
              max={96}
              value={run.size_half_pt}
              addonAfter="半磅"
              onChange={(v) => setRun({ size_half_pt: v ?? undefined })}
            />
          </Col>
        </Row>
      )}

      <Row gutter={[12, 8]}>
        <Col span={8}>
          <Text type="secondary">行距</Text>
          <Select
            style={{ width: '100%' }}
            value={typeof paragraph.line_spacing === 'number' ? 'custom' : paragraph.line_spacing ?? 'single'}
            options={LINE_SPACING_OPTIONS}
            onChange={(v) => {
              if (v === 'custom') return;
              setParagraph({ line_spacing: v as ParagraphProps['line_spacing'] });
            }}
          />
        </Col>
        {(paragraph.line_spacing as string) === 'custom' && (
          <Col span={8}>
            <Text type="secondary">行距固定值（pt）</Text>
            <InputNumber
              style={{ width: '100%' }}
              min={6}
              max={100}
              addonAfter="pt"
              placeholder="如 22"
              onChange={(v) => setParagraph({ line_spacing: v ? (v + 'pt' as unknown as ParagraphProps['line_spacing']) : undefined })}
            />
          </Col>
        )}
        <Col span={8}>
          <Text type="secondary">首行缩进（字符）</Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={10}
            value={paragraph.first_line_chars}
            placeholder="0"
            addonAfter="字符"
            onChange={(v) => setParagraph({ first_line_chars: v ?? undefined })}
          />
        </Col>
      </Row>
    </Space>
  );
};

/* ───────────── 主组件 ───────────── */

interface Props {
  doc: DslDocument;
  onPatch: (updater: (d: DslDocument) => DslDocument) => void;
}

export const MultilevelListEditor: React.FC<Props> = ({ doc, onPatch }) => {
  const ml: MultilevelList | undefined = doc.multilevel_list;

  const setMl = (next: MultilevelList | undefined) =>
    onPatch((d) => ({ ...d, multilevel_list: next }));

  const updateLevel = (idx: number, patch: Partial<MultilevelLevel>) => {
    if (!ml) return;
    const levels = ml.levels.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    setMl({ ...ml, levels });
  };

  const removeLevel = (idx: number) => {
    if (!ml) return;
    const levels = ml.levels
      .filter((_, i) => i !== idx)
      .map((l, i) => ({ ...l, ilvl: i, heading_style: String(i + 1) }));
    setMl({ ...ml, levels });
  };

  const addLevel = () => {
    const base = ml ?? { num_id: 2, levels: [] };
    const nextIlvl = base.levels.length;
    const nextStyle = String(nextIlvl + 1);
    const tokens = Array.from({ length: nextIlvl + 1 }, (_, i) => `%${i + 1}`).join('.');
    setMl({
      ...base,
      levels: [
        ...base.levels,
        {
          ilvl: nextIlvl,
          heading_style: nextStyle,
          num_fmt: 'decimal',
          lvl_text: tokens,
          suff: 'space',
          start: 1,
          is_lgl: nextIlvl > 0,
        },
      ],
    });
  };

  const moveLevel = (idx: number, dir: -1 | 1) => {
    if (!ml) return;
    const j = idx + dir;
    if (j < 0 || j >= ml.levels.length) return;
    const arr = [...ml.levels];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setMl({ ...ml, levels: arr.map((l, i) => ({ ...l, ilvl: i })) });
  };

  if (!ml) {
    return (
      <Card size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="该模板尚未配置多级列表 DSL"
            description="点击下方按钮加载 HUTB 默认方案（H1=一二三、H2=1.1、H3=1.1.1、H4=1.1.1.1），后续可继续微调。"
          />
          <Space>
            <Button type="primary" icon={<RetweetOutlined />} onClick={() => setMl(HUTB_DEFAULT)}>
              加载 HUTB 默认
            </Button>
            <Button onClick={() => setMl({ num_id: 2, levels: [] })}>从空开始</Button>
          </Space>
        </Space>
      </Card>
    );
  }

  const previewCounters = [2, 1, 1, 1];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card size="small" title="预览（模拟第 2 章第 1 节）">
        <Space wrap split={<Text type="secondary">→</Text>}>
          {ml.levels.map((lvl) => (
            <Tag key={lvl.ilvl} color="blue" style={{ fontSize: 14, padding: '4px 10px' }}>
              <Text strong>{previewText(ml.levels, lvl.ilvl, previewCounters)}</Text>
              <Text type="secondary" style={{ marginLeft: 6 }}>
                示例标题{lvl.ilvl + 1}
              </Text>
            </Tag>
          ))}
        </Space>
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <span>关联 numId</span>
            <InputNumber
              min={1}
              value={ml.num_id}
              onChange={(v) => setMl({ ...ml, num_id: Number(v ?? 2) })}
              style={{ width: 90 }}
            />
            <Text type="secondary">（与 word/numbering.xml 内的 numId 对齐）</Text>
          </Space>
        }
        extra={
          <Space>
            <Button size="small" onClick={() => setMl(HUTB_DEFAULT)} icon={<RetweetOutlined />}>
              重置为默认
            </Button>
            <Button size="small" danger onClick={() => setMl(undefined)} icon={<DeleteOutlined />}>
              移除整个多级列表
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {ml.levels.map((lvl, idx) => (
            <Card
              key={idx}
              size="small"
              type="inner"
              title={<Text strong>第 {lvl.ilvl + 1} 级（ilvl={lvl.ilvl}）</Text>}
              extra={
                <Space size={0}>
                  <Tooltip title="上移">
                    <Button
                      type="text"
                      icon={<ArrowUpOutlined />}
                      disabled={idx === 0}
                      onClick={() => moveLevel(idx, -1)}
                    />
                  </Tooltip>
                  <Tooltip title="下移">
                    <Button
                      type="text"
                      icon={<ArrowDownOutlined />}
                      disabled={idx === ml.levels.length - 1}
                      onClick={() => moveLevel(idx, 1)}
                    />
                  </Tooltip>
                  <Tooltip title="删除该级">
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeLevel(idx)} />
                  </Tooltip>
                </Space>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {/* 编号配置区 */}
                <Row gutter={[12, 12]}>
                  <Col span={8}>
                    <Text type="secondary">绑定标题样式</Text>
                    <Select
                      style={{ width: '100%' }}
                      value={lvl.heading_style}
                      options={HEADING_STYLE_OPTIONS}
                      onChange={(v) => updateLevel(idx, { heading_style: v })}
                    />
                  </Col>
                  <Col span={8}>
                    <Text type="secondary">编号格式 (numFmt)</Text>
                    <Select
                      style={{ width: '100%' }}
                      value={lvl.num_fmt}
                      options={NUM_FMT_OPTIONS}
                      onChange={(v) => updateLevel(idx, { num_fmt: v })}
                    />
                  </Col>
                  <Col span={8}>
                    <Text type="secondary">编号显示模板 (lvlText)</Text>
                    <Input
                      value={lvl.lvl_text}
                      placeholder="例如 %1、 或 %1.%2"
                      onChange={(e) => updateLevel(idx, { lvl_text: e.target.value })}
                    />
                  </Col>
                  <Col span={6}>
                    <Text type="secondary">编号后分隔 (suff)</Text>
                    <Select
                      style={{ width: '100%' }}
                      value={lvl.suff ?? 'space'}
                      options={SUFF_OPTIONS}
                      onChange={(v) => updateLevel(idx, { suff: v as MultilevelLevel['suff'] })}
                    />
                  </Col>
                  <Col span={6}>
                    <Text type="secondary">起始号 (start)</Text>
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      value={lvl.start ?? 1}
                      onChange={(v) => updateLevel(idx, { start: Number(v ?? 1) })}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">
                      正规形式编号{' '}
                      <Tooltip title="对应 Word「定义新多级列表」中的「正规形式编号」复选框（OOXML 的 isLgl）。勾选后，本级编号里出现的所有上级编号一律按阿拉伯数字显示，例如 H1 用「一、」时，H2 才能正确呈现「1.1」而不是「一.1」。一般 H1 关闭、H2 起开启。">
                        [?]
                      </Tooltip>
                    </Text>
                    <div>
                      <Switch
                        checked={!!lvl.is_lgl}
                        onChange={(v) => updateLevel(idx, { is_lgl: v })}
                        checkedChildren="开"
                        unCheckedChildren="关"
                      />
                    </div>
                  </Col>
                </Row>

                {/* 每级独立样式：字体/字号/首行缩进/行距 */}
                <Collapse
                  ghost
                  items={[{
                    key: 'style',
                    label: (
                      <Space>
                        <SettingOutlined />
                        <Text type="secondary">该级独立样式设置</Text>
                        {(lvl.paragraph || lvl.run) && (
                          <Tag color="green" style={{ marginLeft: 8 }}>已配置</Tag>
                        )}
                      </Space>
                    ),
                    children: (
                      <LevelStylePanel
                        lvl={lvl}
                        idx={idx}
                        onChange={(patch) => updateLevel(idx, patch)}
                      />
                    ),
                  }]}
                />
              </Space>
            </Card>
          ))}
          <Button block type="dashed" icon={<PlusOutlined />} onClick={addLevel}>
            添加下一级
          </Button>
        </Space>
      </Card>

      <Alert
        type="info"
        showIcon
        message={
          <Space direction="vertical" size={2}>
            <Text strong>常用方案速查</Text>
            <Text>① 学术论文：H1 中文「一、」 + H2/H3 阿拉伯「1.1 / 1.1.1」（isLgl=true）— 即默认配置</Text>
            <Text>② 章节制：H1「第%1章」+ H2「§%1.%2」</Text>
            <Text>③ 报告样式：全部 decimal，「%1.」「%1.%2」「%1.%2.%3」</Text>
          </Space>
        }
      />
    </Space>
  );
};

export { HUTB_DEFAULT as HUTB_DEFAULT_MULTILEVEL };
