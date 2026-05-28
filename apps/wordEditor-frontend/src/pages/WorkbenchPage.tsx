import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  List,
  Tag,
  Tabs,
  Button,
  Space,
  Typography,
  message,
  Tooltip,
  Descriptions,
} from 'antd';
import {
  SaveOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { fetchStylePreviewBlob } from '@/services/previewStyles';
import { DocxPreviewDrawer } from '@/components/preview';
import { useEditorStore, getSelectedTemplate } from '@/store/editorStore';
import { useAppStore } from '@/store/appStore';
import { DslVisualEditor } from '@/components/dsl/DslVisualEditor';
import { ReferenceStylesPanel } from '@/components/dsl/ReferenceStylesPanel';
import { LazyCodeEditor } from '@/components/code/LazyCodeEditor';
import { validateDslYaml } from '@/core/yaml';
import type { EditorTab } from '@/core/types';
import { getTemplateLuaFilters } from '@/core/types';

const { Text, Paragraph } = Typography;

export const WorkbenchPage: React.FC = () => {
  const config = useAppStore((s) => s.config);
  const selectedTemplateId = useEditorStore((s) => s.selectedTemplateId);
  const selectTemplate = useEditorStore((s) => s.selectTemplate);
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const yamlText = useEditorStore((s) => s.yamlText);
  const setYamlText = useEditorStore((s) => s.setYamlText);
  const syncDocFromYaml = useEditorStore((s) => s.syncDocFromYaml);
  const stylesPath = useEditorStore((s) => s.stylesPath);
  const dirty = useEditorStore((s) => s.dirty);
  const saveFile = useEditorStore((s) => s.saveFile);
  const updateFile = useEditorStore((s) => s.updateFile);
  const fileCache = useEditorStore((s) => s.fileCache);

  const entry = useEditorStore((s) => getSelectedTemplate(s, config?.templates));
  const [luaPath, setLuaPath] = useState<string | null>(null);
  const [luaText, setLuaText] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFileName, setPreviewFileName] = useState('style-preview.docx');
  const [previewDownloadUrl, setPreviewDownloadUrl] = useState<string | null>(null);

  const luaFilters = useMemo(
    () => (entry ? getTemplateLuaFilters(entry, config) : []),
    [entry, config],
  );

  useEffect(() => {
    const first = luaFilters[0] ?? null;
    setLuaPath(first);
    if (!first) {
      setLuaText('');
      return;
    }
    const cached = fileCache[first];
    if (cached !== undefined) {
      setLuaText(cached);
      return;
    }
    useEditorStore
      .getState()
      .loadFile(first)
      .then(setLuaText)
      .catch(() => setLuaText(''));
  }, [entry?.id, luaFilters.join(','), fileCache]);

  const yamlValid = useMemo(() => validateDslYaml(yamlText), [yamlText]);

  const handleSaveStyles = useCallback(async () => {
    if (!stylesPath) return;
    if (!yamlValid.ok) {
      message.error(yamlValid.error);
      return;
    }
    setSaving(true);
    try {
      await saveFile(stylesPath);
      message.success('styles.yaml 已保存');
    } catch (e) {
      message.error(String(e));
    } finally {
      setSaving(false);
    }
  }, [stylesPath, yamlValid, saveFile]);

  const runStylePreview = useCallback(async () => {
    if (!entry?.id) return;
    if (!yamlValid.ok) {
      message.error(yamlValid.error);
      return;
    }
    setPreviewing(true);
    setPreviewOpen(true);
    setPreviewBlob(null);
    try {
      const { blob, fileName, downloadUrl } = await fetchStylePreviewBlob({
        templateId: entry.id,
        stylesYaml: yamlText,
      });
      setPreviewBlob(blob);
      setPreviewFileName(fileName);
      setPreviewDownloadUrl(downloadUrl);
    } catch (e) {
      setPreviewOpen(false);
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }, [entry?.id, yamlValid, yamlText]);

  const handlePreviewStyles = () => void runStylePreview();

  const handleSaveLua = useCallback(async () => {
    if (!luaPath) return;
    updateFile(luaPath, luaText);
    setSaving(true);
    try {
      await saveFile(luaPath);
      message.success('Lua 已保存');
    } catch (e) {
      message.error(String(e));
    } finally {
      setSaving(false);
    }
  }, [luaPath, luaText, updateFile, saveFile]);

  const tabItems = [
    { key: 'overview', label: '概览' },
    { key: 'styles', label: '样式总览', disabled: !entry },
    { key: 'visual', label: 'DSL 可视化', disabled: !stylesPath },
    { key: 'yaml', label: 'YAML 源码', disabled: !stylesPath },
    { key: 'lua', label: 'Lua Filter', disabled: luaFilters.length === 0 },
  ];

  return (
    <div className="workbench">
      <DocxPreviewDrawer
        open={previewOpen}
        loading={previewing}
        blob={previewBlob}
        fileName={previewFileName}
        downloadUrl={previewDownloadUrl}
        onClose={() => setPreviewOpen(false)}
        onRefresh={() => void runStylePreview()}
      />
      <aside className="workbench-sidebar">
        <Text type="secondary" className="sidebar-label">
          模板 ({config?.templates.length ?? 0})
        </Text>
        <List
          size="small"
          dataSource={config?.templates ?? []}
          renderItem={(t) => (
            <List.Item
              className={`template-item${t.id === selectedTemplateId ? ' active' : ''}`}
              onClick={() => void selectTemplate(t.id)}
            >
              <List.Item.Meta
                title={t.name}
                description={
                  <Space size={4} wrap>
                    <Tag>{t.id}</Tag>
                    {t.styles_yaml && <Tag color="green">DSL</Tag>}
                    {t.extra_lua_filters?.length ? (
                      <Tag color="purple">Lua</Tag>
                    ) : null}
                    {t.source === 'user' && <Tag color="blue">学校模板</Tag>}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </aside>

      <main className="workbench-main">
        {entry && (
          <>
            <div className="workbench-toolbar">
              <div>
                <Text strong style={{ fontSize: 16 }}>
                  {entry.name}
                </Text>
                <Paragraph type="secondary" style={{ margin: 0 }}>
                  {entry.reference_doc}
                </Paragraph>
              </div>
              <Space>
                {stylesPath && dirty[stylesPath] && (
                  <Tag color="orange">DSL 未保存</Tag>
                )}
                {luaPath && dirty[luaPath] && <Tag color="orange">Lua 未保存</Tag>}
                {activeTab === 'yaml' && (
                  <Tooltip title="从 YAML 同步到可视化表单">
                    <Button
                      icon={<SyncOutlined />}
                      onClick={() => {
                        if (syncDocFromYaml()) message.success('已同步');
                        else message.error('YAML 解析失败');
                      }}
                    >
                      同步表单
                    </Button>
                  </Tooltip>
                )}
                {(activeTab === 'yaml' || activeTab === 'visual') && stylesPath && (
                  <>
                    <Tooltip title="侧栏在线预览（OOXML 标题一/二/三识别 + 样式注入，无需 Word，约数秒）">
                      <Button
                        icon={<EyeOutlined />}
                        loading={previewing}
                        disabled={!yamlValid.ok}
                        onClick={handlePreviewStyles}
                      >
                        在线预览
                      </Button>
                    </Tooltip>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      loading={saving}
                      onClick={() => void handleSaveStyles()}
                      disabled={!yamlValid.ok}
                    >
                      保存 DSL
                    </Button>
                  </>
                )}
                {activeTab === 'lua' && luaPath && (
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saving}
                    onClick={() => void handleSaveLua()}
                  >
                    保存 Lua
                  </Button>
                )}
              </Space>
            </div>

            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as EditorTab)}
              items={tabItems}
              className="workbench-tabs"
            />

            <div className="workbench-editor">
              {activeTab === 'overview' && (
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="模板 ID">{entry.id}</Descriptions.Item>
                  <Descriptions.Item label="reference.doc">
                    {entry.reference_doc}
                  </Descriptions.Item>
                  <Descriptions.Item label="styles.yaml">
                    {entry.styles_yaml ?? (
                      <Text type="secondary">未配置</Text>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Lua filters">
                    {luaFilters.length ? (
                      <Space direction="vertical">
                        {luaFilters.map((p) => (
                          <code key={p}>{p}</code>
                        ))}
                      </Space>
                    ) : (
                      <Text type="secondary">无</Text>
                    )}
                  </Descriptions.Item>
                  {entry.note && (
                    <Descriptions.Item label="说明">{entry.note}</Descriptions.Item>
                  )}
                  <Descriptions.Item label="管线顺序">
                    Pandoc → OOXML 标题/引用 → styles.yaml 注入（见规范文档）
                  </Descriptions.Item>
                </Descriptions>
              )}

              {activeTab === 'styles' && (
                <ReferenceStylesPanel templateId={entry?.id ?? null} />
              )}

              {activeTab === 'visual' && <DslVisualEditor />}

              {activeTab === 'yaml' && stylesPath && (
                <div className="editor-pane">
                  <div className="editor-pane-status">
                    {yamlValid.ok ? (
                      <Text type="success">
                        <CheckCircleOutlined /> YAML 有效
                      </Text>
                    ) : (
                      <Text type="danger">{yamlValid.error}</Text>
                    )}
                  </div>
                  <LazyCodeEditor
                    language="yaml"
                    path={stylesPath}
                    value={yamlText}
                    onChange={setYamlText}
                    height="calc(100vh - 220px)"
                  />
                </div>
              )}

              {activeTab === 'lua' && (
                <div className="editor-pane">
                  {luaFilters.length > 1 && (
                    <Tabs
                      size="small"
                      activeKey={luaPath ?? ''}
                      items={luaFilters.map((p) => ({ key: p, label: p.split('/').pop() }))}
                      onChange={(p) => {
                        setLuaPath(p);
                        void useEditorStore.getState().loadFile(p).then(setLuaText);
                      }}
                      style={{ marginBottom: 8 }}
                    />
                  )}
                  <LazyCodeEditor
                    language="lua"
                    path={luaPath ?? undefined}
                    value={luaText}
                    onChange={(v) => {
                      setLuaText(v);
                      if (luaPath) updateFile(luaPath, v);
                    }}
                    height="calc(100vh - 240px)"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
};
