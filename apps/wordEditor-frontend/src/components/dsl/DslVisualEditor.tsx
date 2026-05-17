import React, { useState } from 'react';
import {
  Card,
  Col,
  Row,
  Input,
  Select,
  Button,
  Space,
  Typography,
  Collapse,
  Tag,
  Empty,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { CustomStyle, DslDocument, HeadingRule, StyleOverride } from '@/core/types';
import { MATCH_KIND_OPTIONS, halfPtLabel } from '@/core/dsl-schema';
import { ParagraphFieldsForm, RunFieldsForm } from './StyleFieldsForm';
import { useEditorStore } from '@/store/editorStore';

const { Text, Title } = Typography;

const MatchEditor: React.FC<{
  match: StyleOverride['match'];
  onChange: (m: StyleOverride['match']) => void;
}> = ({ match, onChange }) => (
  <Space wrap size="small">
    <Select
      allowClear
      placeholder="kind"
      style={{ width: 160 }}
      value={match.kind}
      options={MATCH_KIND_OPTIONS}
      onChange={(v) => onChange({ ...match, kind: v })}
    />
    <Input
      placeholder="styleId"
      style={{ width: 120 }}
      value={match.id}
      onChange={(e) => onChange({ ...match, id: e.target.value || undefined })}
    />
    <Input
      placeholder="样式名"
      style={{ width: 140 }}
      value={match.name}
      onChange={(e) => onChange({ ...match, name: e.target.value || undefined })}
    />
    <Input
      placeholder="name_regex"
      style={{ width: 160 }}
      value={match.name_regex}
      onChange={(e) => onChange({ ...match, name_regex: e.target.value || undefined })}
    />
  </Space>
);

export const DslVisualEditor: React.FC = () => {
  const dslDoc = useEditorStore((s) => s.dslDoc);
  const updateDsl = useEditorStore((s) => s.updateDsl);
  const [activeSection, setActiveSection] = useState<string>('meta');

  if (!dslDoc) {
    return <Empty description="该模板未配置 styles.yaml" />;
  }

  const patch = (updater: (d: DslDocument) => DslDocument) => updateDsl(updater);

  const sections = [
    { key: 'meta', label: '模板与字体' },
    { key: 'overrides', label: `覆盖 (${dslDoc.overrides.length})` },
    { key: 'custom', label: `自定义样式 (${dslDoc.custom_styles.length})` },
    { key: 'headings', label: `标题规则 (${dslDoc.headings?.length ?? 0})` },
    { key: 'semantics', label: '语义映射' },
  ];

  return (
    <div className="dsl-visual">
      <nav className="dsl-nav">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`dsl-nav-item${activeSection === s.key ? ' active' : ''}`}
            onClick={() => setActiveSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="dsl-panel">
        {activeSection === 'meta' && (
          <Card size="small" title="模板元信息">
            <Row gutter={16}>
              <Col span={12}>
                <Text type="secondary">模板 ID</Text>
                <Input
                  value={dslDoc.template.id}
                  onChange={(e) =>
                    patch((d) => ({
                      ...d,
                      template: { ...d.template, id: e.target.value },
                    }))
                  }
                />
              </Col>
              <Col span={12}>
                <Text type="secondary">显示名</Text>
                <Input
                  value={dslDoc.template.name}
                  onChange={(e) =>
                    patch((d) => ({
                      ...d,
                      template: { ...d.template, name: e.target.value },
                    }))
                  }
                />
              </Col>
              <Col span={12} style={{ marginTop: 12 }}>
                <Text type="secondary">西文字体 (fonts.latin)</Text>
                <Input
                  value={dslDoc.fonts.latin ?? ''}
                  onChange={(e) =>
                    patch((d) => ({
                      ...d,
                      fonts: { ...d.fonts, latin: e.target.value || undefined },
                    }))
                  }
                  placeholder="Times New Roman"
                />
              </Col>
              <Col span={12} style={{ marginTop: 12 }}>
                <Text type="secondary">中文字体 (fonts.cjk)</Text>
                <Input
                  value={dslDoc.fonts.cjk ?? ''}
                  onChange={(e) =>
                    patch((d) => ({
                      ...d,
                      fonts: {
                        ...d.fonts,
                        cjk: e.target.value === '' ? null : e.target.value,
                      },
                    }))
                  }
                  placeholder="null = 保留模板默认"
                />
              </Col>
            </Row>
          </Card>
        )}

        {activeSection === 'overrides' && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() =>
                patch((d) => ({
                  ...d,
                  overrides: [
                    ...d.overrides,
                    { match: { kind: 'body' }, word_wrap_break_latin: true },
                  ],
                }))
              }
            >
              添加覆盖规则
            </Button>
            {dslDoc.overrides.map((ov, idx) => (
              <Card
                key={idx}
                size="small"
                title={`覆盖 #${idx + 1}`}
                extra={
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      patch((d) => ({
                        ...d,
                        overrides: d.overrides.filter((_, i) => i !== idx),
                      }))
                    }
                  />
                }
              >
                <Text type="secondary">match 选择器</Text>
                <div style={{ marginBottom: 12 }}>
                  <MatchEditor
                    match={ov.match}
                    onChange={(m) =>
                      patch((d) => {
                        const overrides = [...d.overrides];
                        overrides[idx] = { ...ov, match: m };
                        return { ...d, overrides };
                      })
                    }
                  />
                </div>
                <Row gutter={16}>
                  <Col span={12}>
                    <ParagraphFieldsForm
                      value={ov.paragraph ?? (ov as StyleOverride)}
                      onChange={(p) =>
                        patch((d) => {
                          const overrides = [...d.overrides];
                          overrides[idx] = { ...ov, paragraph: p };
                          return { ...d, overrides };
                        })
                      }
                    />
                  </Col>
                  <Col span={12}>
                    <RunFieldsForm
                      value={ov.run}
                      onChange={(r) =>
                        patch((d) => {
                          const overrides = [...d.overrides];
                          overrides[idx] = { ...ov, run: r };
                          return { ...d, overrides };
                        })
                      }
                    />
                  </Col>
                </Row>
              </Card>
            ))}
          </Space>
        )}

        {activeSection === 'custom' && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() =>
                patch((d) => ({
                  ...d,
                  custom_styles: [
                    ...d.custom_styles,
                    {
                      id: `Style${d.custom_styles.length + 1}`,
                      name: '新样式',
                      based_on: 'a',
                      paragraph: { align: 'left' },
                    },
                  ],
                }))
              }
            >
              添加自定义样式
            </Button>
            {dslDoc.custom_styles.map((st, idx) => (
              <Card
                key={st.id}
                size="small"
                title={
                  <Space>
                    <Tag color="blue">{st.name}</Tag>
                    <Text type="secondary">{st.id}</Text>
                    {st.run?.size_half_pt != null && (
                      <Tag>{halfPtLabel(st.run.size_half_pt)}</Tag>
                    )}
                  </Space>
                }
                extra={
                  <Space>
                    <Tooltip title="复制">
                      <Button
                        type="text"
                        icon={<CopyOutlined />}
                        onClick={() =>
                          patch((d) => {
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
                    <Button
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        patch((d) => ({
                          ...d,
                          custom_styles: d.custom_styles.filter((_, i) => i !== idx),
                        }))
                      }
                    />
                  </Space>
                }
              >
                <Row gutter={12} style={{ marginBottom: 12 }}>
                  <Col span={8}>
                    <Text type="secondary">styleId</Text>
                    <Input
                      value={st.id}
                      onChange={(e) =>
                        patch((d) => {
                          const custom_styles = [...d.custom_styles];
                          custom_styles[idx] = { ...st, id: e.target.value };
                          return { ...d, custom_styles };
                        })
                      }
                    />
                  </Col>
                  <Col span={8}>
                    <Text type="secondary">显示名 (Pandoc custom-style)</Text>
                    <Input
                      value={st.name}
                      onChange={(e) =>
                        patch((d) => {
                          const custom_styles = [...d.custom_styles];
                          custom_styles[idx] = { ...st, name: e.target.value };
                          return { ...d, custom_styles };
                        })
                      }
                    />
                  </Col>
                  <Col span={8}>
                    <Text type="secondary">based_on</Text>
                    <Input
                      value={st.based_on ?? 'a'}
                      onChange={(e) =>
                        patch((d) => {
                          const custom_styles = [...d.custom_styles];
                          custom_styles[idx] = { ...st, based_on: e.target.value };
                          return { ...d, custom_styles };
                        })
                      }
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <ParagraphFieldsForm
                      value={st.paragraph}
                      onChange={(p) =>
                        patch((d) => {
                          const custom_styles = [...d.custom_styles];
                          custom_styles[idx] = { ...st, paragraph: p };
                          return { ...d, custom_styles };
                        })
                      }
                    />
                  </Col>
                  <Col span={12}>
                    <RunFieldsForm
                      value={st.run}
                      onChange={(r) =>
                        patch((d) => {
                          const custom_styles = [...d.custom_styles];
                          custom_styles[idx] = { ...st, run: r };
                          return { ...d, custom_styles };
                        })
                      }
                    />
                  </Col>
                </Row>
              </Card>
            ))}
          </Space>
        )}

        {activeSection === 'headings' && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="secondary">
              文档化字段，对照 macros/ApplyHeadingsAndRemoveNumbering.bas；未来可驱动 VBA 生成。
            </Text>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() =>
                patch((d) => ({
                  ...d,
                  headings: [
                    ...(d.headings ?? []),
                    { pattern: '^\\d+\\.\\d+', level: 2 } as HeadingRule,
                  ],
                }))
              }
            >
              添加标题规则
            </Button>
            {(dslDoc.headings ?? []).map((h, idx) => (
              <Card key={idx} size="small">
                <Row gutter={12} align="middle">
                  <Col flex="auto">
                    <Input
                      addonBefore="正则"
                      value={h.pattern}
                      onChange={(e) =>
                        patch((d) => {
                          const headings = [...(d.headings ?? [])];
                          headings[idx] = { ...h, pattern: e.target.value };
                          return { ...d, headings };
                        })
                      }
                    />
                  </Col>
                  <Col>
                    <Select
                      value={h.level}
                      style={{ width: 100 }}
                      options={[1, 2, 3, 4, 5].map((n) => ({
                        label: `级别 ${n}`,
                        value: n,
                      }))}
                      onChange={(level) =>
                        patch((d) => {
                          const headings = [...(d.headings ?? [])];
                          headings[idx] = { ...h, level };
                          return { ...d, headings };
                        })
                      }
                    />
                  </Col>
                  <Col>
                    <Button
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        patch((d) => ({
                          ...d,
                          headings: (d.headings ?? []).filter((_, i) => i !== idx),
                        }))
                      }
                    />
                  </Col>
                </Row>
              </Card>
            ))}
          </Space>
        )}

        {activeSection === 'semantics' && (
          <Card size="small">
            <Title level={5}>语义映射 (semantics)</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              对照 zhengwen-style.lua；当前仅文档用途。可在 YAML 模式中直接编辑 JSON 结构。
            </Text>
            <Collapse
              items={Object.entries(dslDoc.semantics ?? {}).map(([key, val]) => ({
                key,
                label: key,
                children: (
                  <pre className="dsl-json-preview">{JSON.stringify(val, null, 2)}</pre>
                ),
              }))}
            />
          </Card>
        )}
      </div>
    </div>
  );
};
