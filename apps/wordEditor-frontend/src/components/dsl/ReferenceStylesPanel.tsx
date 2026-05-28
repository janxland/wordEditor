import React, { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Tag,
  Input,
  Select,
  Space,
  Typography,
  Button,
  Tooltip,
  message,
  Alert,
  Spin,
  Empty,
  Segmented,
  Card,
  Modal,
  Descriptions,
} from 'antd';
import {
  CopyOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  BoldOutlined,
  ItalicOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import {
  fetchReferenceStyles,
  type ReferenceStyle,
} from '@/services/referenceStyles';

const { Text } = Typography;

interface Props {
  templateId: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  paragraph: '段落',
  character: '字符',
  table: '表格',
  numbering: '编号',
};

const TYPE_COLOR: Record<string, string> = {
  paragraph: 'blue',
  character: 'purple',
  table: 'gold',
  numbering: 'green',
};

function escapeYamlKey(v: string): string {
  return /[\s:#'"\\]/.test(v) || /^[\d-]/.test(v) ? JSON.stringify(v) : v;
}

/** 将一个样式条目转成可粘贴进 styles.yaml `overrides:` 的 YAML 片段 */
function buildOverrideSnippet(s: ReferenceStyle): string {
  const lines: string[] = [];
  lines.push(`- match:`);
  lines.push(`    id: ${escapeYamlKey(s.styleId)}        # ${s.name}`);
  const runLines: string[] = [];
  const r = s.run;
  if (r.fonts?.eastAsia) runLines.push(`    cjk_font: ${escapeYamlKey(r.fonts.eastAsia)}`);
  if (r.fonts?.ascii) runLines.push(`    latin_font: ${escapeYamlKey(r.fonts.ascii)}`);
  if (r.size_half_pt != null) runLines.push(`    size_half_pt: ${r.size_half_pt}`);
  if (r.bold) runLines.push(`    bold: true`);
  if (r.color) runLines.push(`    color: "${r.color}"`);
  if (runLines.length) {
    lines.push(`  run:`);
    lines.push(...runLines);
  }
  const p = s.paragraph;
  const paraLines: string[] = [];
  if (p.align) paraLines.push(`    align: ${p.align}`);
  const sp = p.spacing;
  if (sp?.line_pt != null && sp.line_rule === 'exact') {
    paraLines.push(`    line_spacing: "${sp.line_pt}pt"`);
  } else if (sp?.line_multi != null) {
    const ls =
      sp.line_multi === 1
        ? 'single'
        : sp.line_multi === 1.5
        ? '"1.5"'
        : sp.line_multi === 2
        ? 'double'
        : `${Math.round(sp.line_multi * 240)}   # twips`;
    paraLines.push(`    line_spacing: ${ls}`);
  }
  const ind = p.indent ?? {};
  if (typeof ind.firstLineChars === 'number') {
    paraLines.push(`    first_line_chars: ${ind.firstLineChars}`);
  }
  if (typeof ind.hangingChars === 'number') {
    paraLines.push(`    hanging_indent_chars: ${ind.hangingChars}`);
  }
  if (paraLines.length) {
    lines.push(`  paragraph:`);
    lines.push(...paraLines);
  }
  if (runLines.length === 0 && paraLines.length === 0) {
    lines.push(`  # TODO: 在 run: / paragraph: 下补充要覆盖的字段`);
  }
  return lines.join('\n');
}

/** 根据 OOXML run 属性构造预览用的 CSS（字号缩按 0.85 避免占位过高） */
function sampleStyleCss(s: ReferenceStyle): React.CSSProperties {
  const r = s.run;
  const p = s.paragraph;
  const families: string[] = [];
  if (r.fonts?.eastAsia) families.push(`"${r.fonts.eastAsia}"`);
  if (r.fonts?.ascii && r.fonts.ascii !== r.fonts?.eastAsia) families.push(`"${r.fonts.ascii}"`);
  families.push('serif');
  const css: React.CSSProperties = {
    fontFamily: families.join(', '),
    fontWeight: r.bold ? 700 : 400,
    fontStyle: r.italic ? 'italic' : 'normal',
    color: r.color && r.color !== 'auto' ? `#${r.color}` : undefined,
    textDecoration: r.underline && r.underline !== 'none' ? 'underline' : undefined,
    textAlign: ((p.align === 'both' ? 'justify' : p.align) as React.CSSProperties['textAlign']) ?? 'left',
    lineHeight: 1.25,
  };
  if (r.size_pt) {
    // 预览中统一按 0.85×实际字号，下限 11px、上限 28px
    const px = Math.max(11, Math.min(28, r.size_pt * 0.85));
    css.fontSize = px;
  } else {
    css.fontSize = 14;
  }
  return css;
}

function sampleText(s: ReferenceStyle): string {
  // 优先用中文名。表格/编号类型加占位例句。
  const n = (s.name || s.styleId).trim();
  if (s.type === 'table') return `${n} · 表格样式`;
  if (s.type === 'numbering') return `${n} · 编号方案`;
  return n;
}

/** Word 中文字号 ↔ 磅值（常用，按零点五容忍一下） */
const CHINESE_SIZE: Array<[number, string]> = [
  [42, '初号'],
  [36, '小初'],
  [26, '一号'],
  [24, '小一'],
  [22, '二号'],
  [18, '小二'],
  [16, '三号'],
  [15, '小三'],
  [14, '四号'],
  [12, '小四'],
  [10.5, '五号'],
  [9, '小五'],
  [7.5, '六号'],
  [6.5, '小六'],
  [5.5, '七号'],
  [5, '八号'],
];

function chineseSizeName(pt: number | undefined): string | null {
  if (pt == null) return null;
  for (const [v, name] of CHINESE_SIZE) {
    if (Math.abs(pt - v) < 0.26) return name;
  }
  return null;
}

const ALIGN_META: Record<string, { icon: React.ReactNode; label: string }> = {
  left: { icon: <AlignLeftOutlined />, label: '左对齐' },
  center: { icon: <AlignCenterOutlined />, label: '居中' },
  right: { icon: <AlignRightOutlined />, label: '右对齐' },
  both: { icon: <MenuOutlined />, label: '两端对齐' },
  distribute: { icon: <MenuOutlined />, label: '分散对齐' },
};

function lineSpacingLabel(sp: ReferenceStyle['paragraph']['spacing']): string | null {
  if (!sp) return null;
  if (sp.line_pt != null && sp.line_rule === 'exact') return `固定值 ${sp.line_pt} 磅`;
  if (sp.line_multi != null) {
    if (Math.abs(sp.line_multi - 1) < 0.01) return '单倍行距';
    if (Math.abs(sp.line_multi - 1.5) < 0.01) return '1.5 倍行距';
    if (Math.abs(sp.line_multi - 2) < 0.01) return '2 倍行距';
    return `多倍行距 × ${sp.line_multi}`;
  }
  return null;
}

export const ReferenceStylesPanel: React.FC<Props> = ({ templateId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docxPath, setDocxPath] = useState('');
  const [styles, setStyles] = useState<ReferenceStyle[]>([]);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [hideHidden, setHideHidden] = useState(true);
  const [view, setView] = useState<'gallery' | 'table'>('gallery');
  const [detail, setDetail] = useState<ReferenceStyle | null>(null);

  const load = React.useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReferenceStyles(templateId);
      setStyles(data.styles);
      setDocxPath(data.docx);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return styles.filter((s) => {
      if (typeFilter !== 'all' && s.type !== typeFilter) return false;
      if (hideHidden && s.hidden) return false;
      if (!kw) return true;
      return (
        s.styleId.toLowerCase().includes(kw) ||
        s.name.toLowerCase().includes(kw) ||
        s.runSummary.toLowerCase().includes(kw) ||
        s.paragraphSummary.toLowerCase().includes(kw)
      );
    });
  }, [styles, keyword, typeFilter, hideHidden]);

  const handleCopy = async (s: ReferenceStyle) => {
    const snippet = buildOverrideSnippet(s);
    try {
      await navigator.clipboard.writeText(snippet);
      message.success(`已复制：${s.name} 的 override 片段`);
    } catch {
      message.warning('剪贴板不可用，请手动复制');
      // eslint-disable-next-line no-console
      console.log(snippet);
    }
  };

  if (!templateId) {
    return <Empty description="请选择模板" />;
  }

  return (
    <div className="reference-styles-panel">
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          placeholder="搜索 styleId / 名称 / 字号 / 字体"
          allowClear
          style={{ width: 260 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部类型' },
            { value: 'paragraph', label: '段落' },
            { value: 'character', label: '字符' },
            { value: 'table', label: '表格' },
            { value: 'numbering', label: '编号' },
          ]}
        />
        <Select
          value={hideHidden ? 'visible' : 'all'}
          onChange={(v) => setHideHidden(v === 'visible')}
          style={{ width: 140 }}
          options={[
            { value: 'visible', label: '仅显示可见' },
            { value: 'all', label: '包含隐藏样式' },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
        <Segmented
          value={view}
          onChange={(v) => setView(v as 'gallery' | 'table')}
          options={[
            { value: 'gallery', icon: <AppstoreOutlined />, label: '预设样式' },
            { value: 'table', icon: <UnorderedListOutlined />, label: '表格' },
          ]}
        />
        <Text type="secondary" style={{ marginLeft: 8 }}>
          {docxPath ? `源：${docxPath}` : ''}
          {styles.length ? `（${filtered.length}/${styles.length}）` : ''}
        </Text>
      </Space>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载失败"
          description={error}
        />
      )}

      <Spin spinning={loading}>
        {view === 'gallery' ? (
          <div
            className="reference-styles-gallery"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
              maxHeight: 'calc(100vh - 340px)',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {filtered.map((s) => {
              const hasFontTag = !!s.run.fonts?.eastAsia;
              const hasLatinTag = !!s.run.fonts?.ascii && s.run.fonts.ascii !== s.run.fonts.eastAsia;
              const hasSizeTag = s.run.size_pt != null;
              const hasAlignTag = !!s.paragraph.align && !!ALIGN_META[s.paragraph.align];
              const hasColorTag = !!s.run.color && s.run.color !== 'auto';
              const hasTags =
                hasFontTag ||
                hasLatinTag ||
                hasSizeTag ||
                s.run.bold ||
                s.run.italic ||
                hasAlignTag ||
                hasColorTag;
              return (
              <Card
                key={s.styleId}
                size="small"
                hoverable
                styles={{ body: { padding: 10 } }}
                onClick={() => setDetail(s)}
                title={
                  <Space size={4} style={{ fontSize: 11 }}>
                    <Tag
                      color={TYPE_COLOR[s.type] ?? 'default'}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {TYPE_LABEL[s.type] ?? s.type}
                    </Tag>
                    <Tooltip title={`styleId: ${s.styleId}${s.basedOn ? ` · 继承 ${s.basedOn}` : ''}`}>
                      <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                        {s.styleId}
                      </Text>
                    </Tooltip>
                  </Space>
                }
                extra={
                  <Tooltip title="复制为 styles.yaml overrides 片段">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCopy(s);
                      }}
                    />
                  </Tooltip>
                }
              >
                <div
                  style={{
                    minHeight: 56,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                      s.paragraph.align === 'center'
                        ? 'center'
                        : s.paragraph.align === 'right'
                        ? 'flex-end'
                        : 'flex-start',
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}
                >
                  <span style={sampleStyleCss(s)} title={s.runSummary}>
                    {sampleText(s)}
                  </span>
                </div>
                {hasTags && (
                  <div
                    style={{
                      // 负 margin 让虚线延伸到卡片边缘
                      margin: '10px -10px -10px',
                      padding: '8px 10px 10px',
                      borderTop: '1px dashed rgba(0,0,0,0.08)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 4,
                    }}
                  >
                    {hasFontTag && (
                      <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                        {s.run.fonts!.eastAsia}
                      </Tag>
                    )}
                    {hasLatinTag && (
                      <Tag style={{ marginInlineEnd: 0 }}>{s.run.fonts!.ascii}</Tag>
                    )}
                    {hasSizeTag && (
                      <Tag color="magenta" style={{ marginInlineEnd: 0 }}>
                        {chineseSizeName(s.run.size_pt) ?? `${s.run.size_pt}磅`}
                        {chineseSizeName(s.run.size_pt) ? ` · ${s.run.size_pt}磅` : ''}
                      </Tag>
                    )}
                    {s.run.bold && (
                      <Tooltip title="加粗">
                        <Tag color="red" style={{ marginInlineEnd: 0, fontWeight: 700, fontFamily: 'serif' }}>
                          <BoldOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                    {s.run.italic && (
                      <Tooltip title="斜体">
                        <Tag style={{ marginInlineEnd: 0 }}>
                          <ItalicOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                    {hasAlignTag && (
                      <Tooltip title={ALIGN_META[s.paragraph.align!].label}>
                        <Tag style={{ marginInlineEnd: 0 }}>
                          {ALIGN_META[s.paragraph.align!].icon}
                        </Tag>
                      </Tooltip>
                    )}
                    {hasColorTag && (
                      <Tag
                        style={{
                          marginInlineEnd: 0,
                          background: `#${s.run.color}`,
                          color: '#fff',
                          border: 'none',
                        }}
                      >
                        #{s.run.color}
                      </Tag>
                    )}
                  </div>
                )}
              </Card>
              );
            })}
            {!loading && filtered.length === 0 && (
              <Empty description="无匹配样式" style={{ gridColumn: '1 / -1' }} />
            )}
          </div>
        ) : (
        <Table
          rowKey="styleId"
          size="small"
          dataSource={filtered}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
          scroll={{ y: 'calc(100vh - 360px)' }}
          columns={[
            {
              title: '类型',
              dataIndex: 'type',
              width: 70,
              render: (v: string) => (
                <Tag color={TYPE_COLOR[v] ?? 'default'}>{TYPE_LABEL[v] ?? v}</Tag>
              ),
            },
            {
              title: 'styleId',
              dataIndex: 'styleId',
              width: 180,
              render: (v: string, row) => (
                <Space size={4}>
                  <Text code copyable={{ text: v, tooltips: ['复制 styleId', '已复制'] }}>
                    {v}
                  </Text>
                  {row.isDefault && <Tag color="red">默认</Tag>}
                  {row.isCustom && <Tag>自定义</Tag>}
                </Space>
              ),
            },
            {
              title: '名称',
              dataIndex: 'name',
              width: 180,
              render: (v: string, row) => (
                <Space size={4}>
                  <span>{v}</span>
                  {row.qFormat && (
                    <Tooltip title="qFormat：会出现在 Word 样式快捷区">
                      <Tag color="cyan">Q</Tag>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: '字符（run）',
              dataIndex: 'runSummary',
              ellipsis: true,
              render: (v: string) => v || <Text type="secondary">—</Text>,
            },
            {
              title: '段落（pPr）',
              dataIndex: 'paragraphSummary',
              ellipsis: true,
              render: (v: string) => v || <Text type="secondary">—</Text>,
            },
            {
              title: '继承',
              dataIndex: 'basedOn',
              width: 100,
              render: (v: string) => v || <Text type="secondary">—</Text>,
            },
            {
              title: '操作',
              key: 'op',
              width: 110,
              fixed: 'right',
              render: (_: unknown, row) => (
                <Tooltip title="复制可粘贴进 styles.yaml overrides: 的 YAML 片段">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => void handleCopy(row)}
                  >
                    overrides
                  </Button>
                </Tooltip>
              ),
            },
          ]}
        />
        )}
      </Spin>

      <Modal
        title={
          detail ? (
            <Space size={6}>
              <Tag color={TYPE_COLOR[detail.type] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                {TYPE_LABEL[detail.type] ?? detail.type}
              </Tag>
              <span>{detail.name}</span>
              <Text type="secondary" code style={{ fontSize: 12 }}>
                {detail.styleId}
              </Text>
            </Space>
          ) : null
        }
        open={!!detail}
        onCancel={() => setDetail(null)}
        width={640}
        footer={[
          <Button key="close" onClick={() => setDetail(null)}>关闭</Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={() => detail && void handleCopy(detail)}
          >
            复制为 overrides 片段
          </Button>,
        ]}
      >
        {detail && (
          <>
            <div
              style={{
                padding: '16px 12px',
                marginBottom: 12,
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 6,
                background: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent:
                  detail.paragraph.align === 'center'
                    ? 'center'
                    : detail.paragraph.align === 'right'
                    ? 'flex-end'
                    : 'flex-start',
              }}
            >
              <span style={{ ...sampleStyleCss(detail), fontSize: undefined }}>
                {sampleText(detail)}
              </span>
            </div>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="styleId">
                <Text code copyable>{detail.styleId}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="类型">{TYPE_LABEL[detail.type] ?? detail.type}</Descriptions.Item>
              <Descriptions.Item label="继承自">{detail.basedOn || '—'}</Descriptions.Item>
              <Descriptions.Item label="下一段样式">{detail.next || '—'}</Descriptions.Item>
              <Descriptions.Item label="link">{detail.link || '—'}</Descriptions.Item>
              <Descriptions.Item label="标记">
                <Space size={4} wrap>
                  {detail.isDefault && <Tag color="red">默认</Tag>}
                  {detail.isCustom && <Tag>自定义</Tag>}
                  {detail.qFormat && <Tag color="cyan">qFormat</Tag>}
                  {detail.hidden && <Tag color="default">隐藏</Tag>}
                  {detail.uiPriority != null && <Tag>uiPriority {detail.uiPriority}</Tag>}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="大纲级别">
                {detail.paragraph.outline_level != null ? detail.paragraph.outline_level : '—'}
              </Descriptions.Item>

              <Descriptions.Item label="中文字体">{detail.run.fonts?.eastAsia ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="西文字体">{detail.run.fonts?.ascii ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="字号">
                {detail.run.size_pt != null
                  ? `${chineseSizeName(detail.run.size_pt) ?? ''} ${detail.run.size_pt} 磅`.trim()
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="加粗 / 斜体">
                <Space size={4}>
                  {detail.run.bold ? <Tag color="red"><BoldOutlined /> 粗</Tag> : null}
                  {detail.run.italic ? <Tag><ItalicOutlined /> 斜</Tag> : null}
                  {!detail.run.bold && !detail.run.italic ? '—' : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="颜色">
                {detail.run.color ? (
                  <Space size={4}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        background: `#${detail.run.color}`,
                        border: '1px solid rgba(0,0,0,0.1)',
                      }}
                    />
                    <Text code>#{detail.run.color}</Text>
                  </Space>
                ) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="下划线">{detail.run.underline ?? '—'}</Descriptions.Item>

              <Descriptions.Item label="对齐方式">
                {detail.paragraph.align && ALIGN_META[detail.paragraph.align] ? (
                  <Space size={4}>
                    {ALIGN_META[detail.paragraph.align].icon}
                    {ALIGN_META[detail.paragraph.align].label}
                  </Space>
                ) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="行距">
                {lineSpacingLabel(detail.paragraph.spacing) ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="段前 / 段后">
                {`${detail.paragraph.spacing?.before_pt ?? 0} / ${detail.paragraph.spacing?.after_pt ?? 0} 磅`}
              </Descriptions.Item>
              <Descriptions.Item label="缩进">
                {detail.paragraph.indent && Object.keys(detail.paragraph.indent).length ? (
                  <Space size={4} wrap>
                    {Object.entries(detail.paragraph.indent).map(([k, v]) => (
                      <Tag key={k} style={{ marginInlineEnd: 0 }}>
                        {k}: {String(v)}
                      </Tag>
                    ))}
                  </Space>
                ) : '—'}
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Modal>
    </div>
  );
};
