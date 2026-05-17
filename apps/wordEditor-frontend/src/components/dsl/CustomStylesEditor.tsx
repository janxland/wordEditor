import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Col,
  Collapse,
  Input,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { CollapseProps } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExpandAltOutlined,
  CompressOutlined,
} from '@ant-design/icons';
import type { CustomStyle, DslDocument } from '@/core/types';
import { halfPtLabel } from '@/core/dsl-schema';
import { ParagraphFieldsForm, RunFieldsForm } from './StyleFieldsForm';

const { Text } = Typography;

function styleSummaryTags(st: CustomStyle): React.ReactNode {
  const tags: React.ReactNode[] = [];
  const p = st.paragraph;
  const r = st.run;
  if (p?.align) tags.push(<Tag key="align">{p.align}</Tag>);
  if (p?.line_spacing != null) {
    tags.push(<Tag key="ls">{String(p.line_spacing)}</Tag>);
  }
  if (p?.first_line_chars != null) {
    tags.push(<Tag key="fi">首行{p.first_line_chars}字</Tag>);
  }
  if (p?.word_wrap_break_latin) tags.push(<Tag key="ww">西文断行</Tag>);
  if (r?.size_half_pt != null) {
    tags.push(<Tag key="sz">{halfPtLabel(r.size_half_pt)}</Tag>);
  }
  if (r?.latin_font) tags.push(<Tag key="lat">{r.latin_font}</Tag>);
  if (tags.length === 0) {
    return <Text type="secondary" style={{ fontSize: 12 }}>未配置段落/字符属性</Text>;
  }
  return <Space size={4} wrap>{tags}</Space>;
}

interface CustomStylesEditorProps {
  styles: CustomStyle[];
  onPatch: (updater: (d: DslDocument) => DslDocument) => void;
}

export const CustomStylesEditor: React.FC<CustomStylesEditorProps> = ({
  styles,
  onPatch,
}) => {
  const allKeys = useMemo(() => styles.map((s) => s.id), [styles]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setActiveKeys((prev) => prev.filter((k) => allKeys.includes(k)));
  }, [allKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return styles;
    return styles.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.based_on ?? '').toLowerCase().includes(q),
    );
  }, [styles, search]);

  const expandAll = () => setActiveKeys([...allKeys]);
  const collapseAll = () => setActiveKeys([]);

  const updateStyleAt = (idx: number, next: CustomStyle) => {
    onPatch((d) => {
      const custom_styles = [...d.custom_styles];
      custom_styles[idx] = next;
      return { ...d, custom_styles };
    });
  };

  const collapseItems: CollapseProps['items'] = filtered.map((st) => {
    const idx = styles.findIndex((s) => s.id === st.id);
    if (idx < 0) return null;

    return {
      key: st.id,
      label: (
        <div className="dsl-custom-collapse-label">
          <Space wrap size={6} align="center">
            <Text strong className="dsl-custom-style-name">
              {st.name}
            </Text>
            <Text type="secondary" className="dsl-custom-style-id">
              {st.id}
            </Text>
            {styleSummaryTags(st)}
          </Space>
        </div>
      ),
      extra: (
        <Space
          size={0}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Tooltip title="复制">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() =>
                onPatch((d) => {
                  const copy = structuredClone(st) as CustomStyle;
                  copy.id = `${st.id}_copy`;
                  copy.name = `${st.name} (副本)`;
                  const custom_styles = [...d.custom_styles];
                  custom_styles.splice(idx + 1, 0, copy);
                  return { ...d, custom_styles };
                })
              }
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              danger
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              onClick={() =>
                onPatch((d) => ({
                  ...d,
                  custom_styles: d.custom_styles.filter((_, i) => i !== idx),
                }))
              }
            />
          </Tooltip>
        </Space>
      ),
      children: (
        <div className="dsl-custom-style-body">
          <div className="dsl-custom-section">
            <Text type="secondary" className="dsl-custom-section-title">
              标识
            </Text>
            <Row gutter={[12, 8]}>
              <Col xs={24} sm={8}>
                <Text type="secondary" className="dsl-field-label">
                  styleId
                </Text>
                <Input
                  size="small"
                  value={st.id}
                  onChange={(e) => updateStyleAt(idx, { ...st, id: e.target.value })}
                />
              </Col>
              <Col xs={24} sm={8}>
                <Text type="secondary" className="dsl-field-label">
                  显示名 (Pandoc custom-style)
                </Text>
                <Input
                  size="small"
                  value={st.name}
                  onChange={(e) => updateStyleAt(idx, { ...st, name: e.target.value })}
                />
              </Col>
              <Col xs={24} sm={8}>
                <Text type="secondary" className="dsl-field-label">
                  based_on
                </Text>
                <Input
                  size="small"
                  value={st.based_on ?? 'a'}
                  onChange={(e) =>
                    updateStyleAt(idx, { ...st, based_on: e.target.value })
                  }
                />
              </Col>
            </Row>
          </div>

          <Row gutter={[12, 12]} className="dsl-custom-props-row">
            <Col xs={24} lg={12}>
              <ParagraphFieldsForm
                value={st.paragraph}
                onChange={(p) => updateStyleAt(idx, { ...st, paragraph: p })}
              />
            </Col>
            <Col xs={24} lg={12}>
              <RunFieldsForm
                value={st.run}
                onChange={(r) => updateStyleAt(idx, { ...st, run: r })}
              />
            </Col>
          </Row>
        </div>
      ),
    };
  }).filter(Boolean) as CollapseProps['items'];

  return (
    <div className="dsl-custom-styles">
      <div className="dsl-custom-toolbar">
        <Space wrap>
          <Button
            size="small"
            icon={<ExpandAltOutlined />}
            onClick={expandAll}
            disabled={styles.length === 0}
          >
            全部展开
          </Button>
          <Button
            size="small"
            icon={<CompressOutlined />}
            onClick={collapseAll}
            disabled={activeKeys.length === 0}
          >
            全部收起
          </Button>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              const newId = `Style${styles.length + 1}`;
              onPatch((d) => ({
                ...d,
                custom_styles: [
                  ...d.custom_styles,
                  {
                    id: newId,
                    name: '新样式',
                    based_on: 'a',
                    paragraph: { align: 'left' },
                  },
                ],
              }));
              setActiveKeys((prev) => [...prev, newId]);
            }}
          >
            添加样式
          </Button>
        </Space>
        <Input.Search
          allowClear
          size="small"
          placeholder="按名称 / styleId 筛选"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="dsl-custom-search"
        />
      </div>

      <Text type="secondary" className="dsl-custom-hint">
        共 {styles.length} 个样式
        {search.trim() ? `，筛选显示 ${filtered.length} 个` : ''}
        {activeKeys.length > 0 ? `，已展开 ${activeKeys.length} 个` : '，已全部收起'}
      </Text>

      {filtered.length === 0 ? (
        <Text type="secondary">无匹配样式</Text>
      ) : (
        <Collapse
          className="dsl-custom-collapse"
          bordered={false}
          activeKey={activeKeys}
          onChange={(keys) =>
            setActiveKeys(Array.isArray(keys) ? keys : keys ? [keys] : [])
          }
          items={collapseItems}
        />
      )}
    </div>
  );
};
