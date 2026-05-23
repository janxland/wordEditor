import React from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  InputNumber,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type {
  DslDocument,
  ListStyleLibraryItem,
  UseListStyleItem,
} from '@/core/types';
import {
  BUILTIN_LIST_STYLE_LIBRARY,
  DEFAULT_ENABLED_LIST_STYLES,
} from '@/core/listStyleLibrary';

const { Text } = Typography;

/* ───────────── 预览渲染 ───────────── */

const CN = '〇一二三四五六七八九';
function cn(n: number): string {
  if (n < 10) return CN[n] || String(n);
  if (n < 20) return '十' + (n === 10 ? '' : CN[n - 10]);
  const t = Math.floor(n / 10);
  const o = n % 10;
  return CN[t] + '十' + (o === 0 ? '' : CN[o]);
}
function fmtN(fmt: string, n: number): string {
  switch (fmt) {
    case 'decimal':
      return String(n);
    case 'chineseCounting':
      return cn(n);
    case 'upperLetter':
      return String.fromCharCode(64 + n);
    case 'lowerLetter':
      return String.fromCharCode(96 + n);
    case 'decimalEnclosedCircle':
      return '①②③④⑤⑥⑦⑧⑨⑩'[n - 1] || `(${n})`;
    case 'bullet':
      return '';
    case 'none':
      return '';
    default:
      return String(n);
  }
}

function previewItems(style: ListStyleLibraryItem | undefined, count = 3): string[] {
  const lst = style?.list;
  if (!lst) return [];
  const text = lst.lvl_text || '%1.';
  const fmt = lst.num_fmt || 'decimal';
  const sep = lst.suff === 'tab' ? '    ' : lst.suff === 'nothing' ? '' : ' ';
  return Array.from({ length: count }, (_, i) => {
    const n = (lst.start ?? 1) + i;
    const numStr = fmt === 'bullet' ? text : text.replace(/%1/g, fmtN(fmt, n));
    return `${numStr}${sep}示例条目${i + 1}`;
  });
}

/* ───────────── 库样式的扁平化（应用 based_on） ───────────── */

function flattenLibrary(library: ListStyleLibraryItem[]): Map<string, ListStyleLibraryItem> {
  const idx = new Map<string, ListStyleLibraryItem>(library.map((s) => [s.id, s]));
  const cache = new Map<string, ListStyleLibraryItem>();
  const resolve = (sid: string, chain: string[] = []): ListStyleLibraryItem => {
    const cached = cache.get(sid);
    if (cached) return cached;
    if (chain.includes(sid)) return idx.get(sid) ?? ({ id: sid, name: sid } as ListStyleLibraryItem);
    const s = idx.get(sid);
    if (!s) return { id: sid, name: sid } as ListStyleLibraryItem;
    const parent =
      s.based_on && idx.has(s.based_on) ? resolve(s.based_on, [...chain, sid]) : undefined;
    const flat: ListStyleLibraryItem = {
      ...s,
      paragraph: { ...(parent?.paragraph ?? {}), ...(s.paragraph ?? {}) },
      run: { ...(parent?.run ?? {}), ...(s.run ?? {}) },
      list: { ...(parent?.list ?? {}), ...(s.list ?? {}) } as ListStyleLibraryItem['list'],
    };
    cache.set(sid, flat);
    return flat;
  };
  return new Map(library.map((s) => [s.id, resolve(s.id)]));
}

/* ───────────── 单条 override 行（缩进 / 制表符 / 起始号） ───────────── */

const OverrideRow: React.FC<{
  use: UseListStyleItem;
  onChange: (next: UseListStyleItem) => void;
}> = ({ use, onChange }) => {
  const p = use.overrides?.paragraph ?? {};
  const l = use.overrides?.list ?? {};
  const setP = (patch: Partial<typeof p>) =>
    onChange({
      ...use,
      overrides: { ...use.overrides, paragraph: { ...p, ...patch } },
    });
  const setL = (patch: Partial<typeof l>) =>
    onChange({
      ...use,
      overrides: { ...use.overrides, list: { ...l, ...patch } },
    });
  return (
    <Card size="small" type="inner" style={{ marginTop: 8, background: '#fafafa' }}>
      <Row gutter={[12, 12]}>
        <Col span={8}>
          <Text type="secondary">首行缩进字符数</Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={10}
            value={p.first_line_chars ?? 0}
            onChange={(v) => setP({ first_line_chars: Number(v ?? 0) })}
          />
        </Col>
        <Col span={8}>
          <Text type="secondary">悬挂缩进字符数</Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={10}
            value={p.hanging_indent_chars ?? 0}
            onChange={(v) => setP({ hanging_indent_chars: Number(v ?? 0) })}
          />
        </Col>
        <Col span={8}>
          <Text type="secondary">
            起始号{' '}
            <Tooltip title="覆盖库中的 list.start，例如让本模板从 5 开始计数">[?]</Tooltip>
          </Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            value={l.start ?? 1}
            onChange={(v) => setL({ start: Number(v ?? 1) })}
          />
        </Col>
      </Row>
    </Card>
  );
};

/* ───────────── 主组件 ───────────── */

interface Props {
  doc: DslDocument;
  onPatch: (updater: (d: DslDocument) => DslDocument) => void;
}

export const ListStyleLibraryEditor: React.FC<Props> = ({ doc, onPatch }) => {
  // 模板若未直接声明 list_style_library（绝大多数仅通过 extends 继承）
  // 前端用内置常量兜底展示，启用即写入 use_list_styles —— 后端 extends 链合并即可生效。
  const inlineLibrary = doc.list_style_library ?? [];
  const usingBuiltin = inlineLibrary.length === 0;
  const library: ListStyleLibraryItem[] = usingBuiltin
    ? BUILTIN_LIST_STYLE_LIBRARY
    : inlineLibrary;
  const useList: UseListStyleItem[] = doc.use_list_styles ?? [];
  const flat = React.useMemo(() => flattenLibrary(library), [library]);
  const [editing, setEditing] = React.useState<string | null>(null);

  const enabledSet = new Set(useList.map((u) => u.id));

  const toggle = (sid: string, on: boolean) => {
    onPatch((d) => {
      const cur = d.use_list_styles ?? [];
      if (on) {
        if (cur.some((u) => u.id === sid)) return d;
        return { ...d, use_list_styles: [...cur, { id: sid }] };
      }
      return { ...d, use_list_styles: cur.filter((u) => u.id !== sid) };
    });
    if (!on && editing === sid) setEditing(null);
  };

  const enableDefaults = () => {
    onPatch((d) => {
      const cur = d.use_list_styles ?? [];
      const next = [...cur];
      for (const id of DEFAULT_ENABLED_LIST_STYLES) {
        if (!next.some((u) => u.id === id)) next.push({ id });
      }
      return { ...d, use_list_styles: next };
    });
  };

  const disableAll = () => {
    onPatch((d) => ({ ...d, use_list_styles: [] }));
    setEditing(null);
  };

  const updateUse = (sid: string, next: UseListStyleItem) =>
    onPatch((d) => ({
      ...d,
      use_list_styles: (d.use_list_styles ?? []).map((u) => (u.id === sid ? next : u)),
    }));

  if (library.length === 0) {
    return (
      <Empty description="列表样式库未加载" />
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert
        type={usingBuiltin ? 'success' : 'info'}
        showIcon
        message={
          <Space direction="vertical" size={2}>
            <Text strong>
              {usingBuiltin
                ? '当前展示：内置标准库（与 _shared/list-style-library.yaml 一致）'
                : '当前展示：模板内联的 list_style_library'}
            </Text>
            <Text>
              <Tag color="purple">ListBase</Tag> 元样式：0 缩进 + 无制表符。
              其它样式基于它派生，仅声明编号差异。
            </Text>
            <Text type="secondary">
              勾选 = 启用并写入 <Text code>use_list_styles</Text>；保存模板后构建即生效（后端
              自动从 extends 链合并库定义，模板 yaml 无需写入库本身）。
            </Text>
          </Space>
        }
        action={
          <Space>
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={enableDefaults}
            >
              一键启用默认 5 款
            </Button>
            {useList.length > 0 && (
              <Button size="small" danger onClick={disableAll}>
                全部停用
              </Button>
            )}
          </Space>
        }
      />

      {library.map((raw) => {
        const style = flat.get(raw.id) ?? raw;
        const isBase = raw.id === 'ListBase';
        const enabled = enabledSet.has(raw.id);
        const use = useList.find((u) => u.id === raw.id);
        return (
          <Card
            key={raw.id}
            size="small"
            title={
              <Space>
                <Checkbox
                  checked={enabled}
                  disabled={isBase}
                  onChange={(e) => toggle(raw.id, e.target.checked)}
                >
                  <Text strong>{raw.name}</Text>
                </Checkbox>
                <Tag color="default">{raw.id}</Tag>
                {raw.based_on && (
                  <Tag color="purple">基: {raw.based_on}</Tag>
                )}
                {isBase && <Tag color="gold">元样式</Tag>}
              </Space>
            }
            extra={
              enabled && !isBase ? (
                <Space>
                  <Button
                    size="small"
                    type={editing === raw.id ? 'primary' : 'default'}
                    icon={<EditOutlined />}
                    onClick={() => setEditing(editing === raw.id ? null : raw.id)}
                  >
                    缩进/制表符
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => toggle(raw.id, false)}
                  >
                    停用
                  </Button>
                </Space>
              ) : null
            }
          >
            <Row gutter={16}>
              <Col span={14}>
                {raw.description && (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {raw.description}
                  </Text>
                )}
                <Space direction="vertical" size={2} style={{ background: '#fff', padding: 8, borderRadius: 4, width: '100%' }}>
                  {previewItems(style).map((line, i) => (
                    <Text key={i} style={{ fontFamily: 'inherit' }}>{line}</Text>
                  )) ?? null}
                  {!style.list && <Text type="secondary">（元样式无编号预览）</Text>}
                </Space>
              </Col>
              <Col span={10}>
                <Space direction="vertical" size={2}>
                  <Text type="secondary">
                    <Text code>num_fmt</Text> {style.list?.num_fmt ?? '—'}
                  </Text>
                  <Text type="secondary">
                    <Text code>lvl_text</Text> {style.list?.lvl_text || '（无）'}
                  </Text>
                  <Text type="secondary">
                    <Text code>suff</Text> {style.list?.suff ?? 'space'}
                  </Text>
                  <Text type="secondary">
                    <Text code>首行/悬挂</Text> {style.paragraph?.first_line_chars ?? 0} /{' '}
                    {style.paragraph?.hanging_indent_chars ?? 0}
                  </Text>
                </Space>
              </Col>
            </Row>
            {enabled && editing === raw.id && use && (
              <OverrideRow use={use} onChange={(next) => updateUse(raw.id, next)} />
            )}
          </Card>
        );
      })}
    </Space>
  );
};
