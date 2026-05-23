import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Button, Space, Spin, Typography, Alert } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { renderDocxToElement } from './renderDocx';
import { downloadFile } from '@/services/download';

const { Text } = Typography;

export interface DocxPreviewDrawerProps {
  open: boolean;
  loading?: boolean;
  blob: Blob | null;
  fileName?: string;
  downloadUrl?: string | null;
  onClose: () => void;
  onRefresh?: () => void;
}

export const DocxPreviewDrawer: React.FC<DocxPreviewDrawerProps> = ({
  open,
  loading = false,
  blob,
  fileName = 'preview.docx',
  downloadUrl,
  onClose,
  onRefresh,
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !blob || !bodyRef.current) return;
    let cancelled = false;
    setRendering(true);
    setRenderError(null);
    void renderDocxToElement(blob, bodyRef.current, styleRef.current)
      .catch((e) => {
        if (!cancelled) {
          setRenderError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, blob]);

  const busy = loading || rendering;

  return (
    <Drawer
      title="Word 在线预览"
      placement="right"
      width="min(920px, 92vw)"
      open={open}
      onClose={onClose}
      destroyOnClose
      className="docx-preview-drawer"
      extra={
        <Space>
          {onRefresh && (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={onRefresh}
            >
              刷新
            </Button>
          )}
          {downloadUrl && (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => void downloadFile(downloadUrl, fileName)}
            >
              下载
            </Button>
          )}
        </Space>
      }
    >
      <Text type="secondary" className="docx-preview-hint">
        预览含 OOXML 标题识别（一、/1.1/1.1.1 等 → 标题 1/2/3）与 styles.yaml；网页渲染与桌面 Word 在字体/分页上可能略有差异。
      </Text>

      {renderError && (
        <Alert
          type="error"
          showIcon
          message="预览渲染失败"
          description={renderError}
          style={{ marginBottom: 12 }}
        />
      )}

      <div className="docx-preview-stage">
        {busy && (
          <div className="docx-preview-loading">
            <Spin tip={loading ? '正在生成预览…' : '正在渲染…'} />
          </div>
        )}
        <div ref={styleRef} className="docx-preview-style-host" />
        <div ref={bodyRef} className="docx-preview-body" />
      </div>
    </Drawer>
  );
};
