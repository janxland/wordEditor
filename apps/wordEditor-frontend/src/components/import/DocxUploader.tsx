import React, { useCallback, useRef, useState } from 'react';
import { Upload, Button, Space, Typography } from 'antd';
import { InboxOutlined, FileWordOutlined } from '@ant-design/icons';
import { useImportStore } from '@/store/importStore';

const { Dragger } = Upload;
const { Text } = Typography;

/** DOCX 上传卡 —— 支持拖拽 / 点击选择，单文件，自动触发还原 */
export const DocxUploader: React.FC = () => {
  const busy = useImportStore((s) => s.busy);
  const sourceName = useImportStore((s) => s.sourceName);
  const sourceSize = useImportStore((s) => s.sourceSize);
  const runImport = useImportStore((s) => s.runImport);
  const reset = useImportStore((s) => s.reset);

  const inputRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState<string>('');

  const handleFile = useCallback(
    async (file: File) => {
      setHint('');
      await runImport(file);
    },
    [runImport],
  );

  const sizeLabel =
    sourceSize > 1024 * 1024
      ? `${(sourceSize / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(sourceSize / 1024)} KB`;

  return (
    <div className="docx-uploader">
      <Dragger
        multiple={false}
        accept=".docx"
        showUploadList={false}
        disabled={busy}
        beforeUpload={(file) => {
          void handleFile(file as unknown as File);
          return false; // 阻止 antd 自动上传
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽 .docx 到此区域</p>
        <p className="ant-upload-hint">
          仅支持单个 .docx；服务端调用 <Text code>extract_docx_to_md.py</Text> 还原 MD 与图片
        </p>
      </Dragger>

      <Space style={{ marginTop: 12 }} size={8} wrap>
        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <Button
          icon={<FileWordOutlined />}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          选择文件
        </Button>
        {sourceName && (
          <Button type="text" disabled={busy} onClick={reset}>
            清除
          </Button>
        )}
        {sourceName && (
          <Text type="secondary">
            {sourceName} · {sizeLabel}
          </Text>
        )}
        {hint && <Text type="warning">{hint}</Text>}
      </Space>
    </div>
  );
};
