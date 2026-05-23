import React from 'react';
import { Modal, Button, Space, Typography, Tag } from 'antd';
import {
  CheckCircleFilled,
  DownloadOutlined,
  FileWordOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;

export interface ExportResultModalProps {
  open: boolean;
  fileName: string;
  templateName?: string;
  elapsedMs?: number;
  downloading?: boolean;
  onDownload: () => void;
  onExportAgain: () => void;
  onClose: () => void;
}

function formatElapsed(ms?: number): string | null {
  if (ms == null || ms < 0) return null;
  const s = (ms / 1000).toFixed(1);
  return `耗时 ${s} 秒`;
}

export const ExportResultModal: React.FC<ExportResultModalProps> = ({
  open,
  fileName,
  templateName,
  elapsedMs,
  downloading,
  onDownload,
  onExportAgain,
  onClose,
}) => {
  const elapsedLabel = formatElapsed(elapsedMs);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={440}
      className="export-result-modal"
      destroyOnClose
    >
      <div className="export-result-card">
        <div className="export-result-icon-wrap">
          <CheckCircleFilled className="export-result-icon" />
        </div>
        <Title level={4} style={{ margin: '12px 0 4px', textAlign: 'center' }}>
          Word 文档已就绪
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
          管线执行完成，可立即下载或继续编辑文稿
        </Text>

        <div className="export-result-file">
          <FileWordOutlined style={{ fontSize: 28, color: '#2563eb' }} />
          <div className="export-result-file-meta">
            <Text strong ellipsis>
              {fileName}
            </Text>
            <Space size={6} wrap style={{ marginTop: 4 }}>
              {templateName && <Tag color="blue">{templateName}</Tag>}
              {elapsedLabel && <Tag>{elapsedLabel}</Tag>}
            </Space>
          </div>
        </div>

        <Space direction="vertical" style={{ width: '100%', marginTop: 20 }} size={10}>
          <Button
            type="primary"
            size="large"
            block
            icon={<DownloadOutlined />}
            loading={downloading}
            onClick={onDownload}
          >
            下载 Word 文档
          </Button>
          <Button block icon={<ReloadOutlined />} onClick={onExportAgain}>
            再次导出
          </Button>
          <Button type="text" block onClick={onClose}>
            关闭
          </Button>
        </Space>
      </div>
    </Modal>
  );
};
