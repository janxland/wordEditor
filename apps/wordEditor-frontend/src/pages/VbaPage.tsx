import React, { useCallback, useEffect, useState } from 'react';
import { List, Button, Space, Typography, message, Tag, Alert } from 'antd';
import { SaveOutlined, FileProtectOutlined } from '@ant-design/icons';
import { LazyCodeEditor } from '@/components/code/LazyCodeEditor';
import { useEditorStore } from '@/store/editorStore';
import { useAppStore } from '@/store/appStore';

const { Text, Paragraph } = Typography;

const MACRO_HINTS: Record<string, string> = {
  ApplyHeadingsAndRemoveNumbering:
    '识别「一、」/ 1.1 / 1.1.1 等前缀 → 套用标题样式，保留编号文字',
  ConvertLaTeXToWordFormula: '行内 \\(...\\) 与 $...$ → Word EQ 域公式',
  ManualRefToBookmarkSuperscript: '正文 [N] → 上标 REF 域（需书签 RefN）',
};

export const VbaPage: React.FC = () => {
  const macros = useAppStore((s) => s.macros);
  const loadMacros = useAppStore((s) => s.loadMacros);
  const loadFile = useEditorStore((s) => s.loadFile);
  const updateFile = useEditorStore((s) => s.updateFile);
  const saveFile = useEditorStore((s) => s.saveFile);
  const dirty = useEditorStore((s) => s.dirty);
  const fileCache = useEditorStore((s) => s.fileCache);

  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadMacros();
  }, [loadMacros]);

  useEffect(() => {
    if (macros.length && !selected) {
      setSelected(macros[0].file);
    }
  }, [macros, selected]);

  useEffect(() => {
    if (!selected) return;
    const cached = fileCache[selected];
    if (cached !== undefined) {
      setCode(cached);
      return;
    }
    void loadFile(selected).then(setCode).catch(() => setCode(''));
  }, [selected, fileCache, loadFile]);

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await saveFile(selected);
      message.success('VBA 已保存（请确保 GBK/mbcs 编码，见规范文档）');
    } catch (e) {
      message.error(String(e));
    } finally {
      setSaving(false);
    }
  }, [selected, saveFile]);

  const current = macros.find((m) => m.file === selected);

  return (
    <div className="vba-page">
      <Alert
        type="info"
        showIcon
        icon={<FileProtectOutlined />}
        message="VBA 后处理宏"
        description="由 postprocess_word.py 通过 COM 导入执行。保存时请保持 GBK 编码约定，避免 UTF-8 BOM 导致 VBA 静默拒绝。"
        style={{ marginBottom: 16 }}
      />
      <div className="vba-layout">
        <List
          className="vba-list"
          size="small"
          header={<Text strong>宏文件</Text>}
          dataSource={macros}
          renderItem={(m) => (
            <List.Item
              className={`template-item${m.file === selected ? ' active' : ''}`}
              onClick={() => setSelected(m.file)}
            >
              <List.Item.Meta
                title={m.name}
                description={
                  MACRO_HINTS[m.name] ?? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {m.file}
                    </Text>
                  )
                }
              />
            </List.Item>
          )}
        />
        <div className="vba-editor">
          <div className="workbench-toolbar">
            <Space>
              <Text strong>{current?.name}</Text>
              <Tag>{selected}</Tag>
              {selected && dirty[selected] && <Tag color="orange">未保存</Tag>}
            </Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!selected}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
          </div>
          <LazyCodeEditor
            language="vb"
            path={selected ?? undefined}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (selected) updateFile(selected, v);
            }}
            height="calc(100vh - 200px)"
          />
          <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
            提示：标题宏使用 wdStyleHeading 常量跨语言；引用宏需 MD 中 &lt;a id=&quot;RefN&quot;&gt; 书签。
          </Paragraph>
        </div>
      </div>
    </div>
  );
};
