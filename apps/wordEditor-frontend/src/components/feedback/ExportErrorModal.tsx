import React from 'react';
import { Modal, Button, Typography, Collapse } from 'antd';
import { CloseCircleFilled } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export interface ExportErrorModalProps {
  open: boolean;
  title?: string;
  error: string;
  logs: string[];
  onRetry: () => void;
  onClose: () => void;
}

export const ExportErrorModal: React.FC<ExportErrorModalProps> = ({
  open,
  title = '????',
  error,
  logs,
  onRetry,
  onClose,
}) => (
  <Modal
    open={open}
    onCancel={onClose}
    footer={[
      <Button key="close" onClick={onClose}>
        ??
      </Button>,
      <Button key="retry" type="primary" danger onClick={onRetry}>
        ??
      </Button>,
    ]}
    centered
    width={520}
    className="export-error-modal"
    destroyOnClose
  >
    <div className="export-error-hero">
      <CloseCircleFilled className="export-error-icon" />
      <div>
        <Text strong style={{ fontSize: 16 }}>
          {title}
        </Text>
        <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
          ??? Pandoc?Word ??? reference.docx
        </Paragraph>
      </div>
    </div>
    <pre className="export-error-pre">{error}</pre>
    {logs.length > 0 && (
      <Collapse
        ghost
        size="small"
        style={{ marginTop: 12 }}
        items={[
          {
            key: 'log',
            label: `?????${logs.length} ??`,
            children: <pre className="export-error-pre export-error-log">{logs.join('\n')}</pre>,
          },
        ]}
      />
    )}
  </Modal>
);
