import React from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
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
} from '@ant-design/icons';
import type {
  DslDocument,
  MultilevelLevel,
  MultilevelList,
} from '@/core/types';

const { Text, Title } = Typography;

/* ───────────── 默认值（与 templates/_shared/hutb-base.yaml 一致） ───────────── */

const HUTB_DEFAULT: MultilevelList = {
  num_id: 2,
  levels: [
    { ilvl: 0, heading_style: '1', num_fmt: 'chineseCounting', lvl_text: '%1、', suff: 'nothing', start: 1 },
    { ilvl: 1, heading_style: '2', num_fmt: 'decimal', lvl_text: '%1.%2', suff: 'space', start: 1, is_lgl: true },
    { ilvl: 2, heading_style: '3', num_fmt: 'decimal', lvl_text: '%1.%2.%3', suff: 'space', start: 1, is_lgl: true },
    { ilvl: 3, heading_style: '4', num_fmt: 'decimal', lvl_text: '%1.%2.%3.%4', suff: 'space', start: 1, is_lgl: true },
  ],
};

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
    if (refIdx < ilvl && lvl.is_lgl) return String(cnt); // isLgl 强制阿拉伯
    const refFmt = levels[refIdx]?.num_fmt ?? 'decimal';
    return fmtNumber(refFmt, cnt);
  });
}

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
    // ilvl 跟随顺序重排
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

  // 预览：模拟 H1 #2 的 H2 #1 → 计数器 [2, 1, 1, 1]
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
