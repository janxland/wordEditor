import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Progress, Steps, Typography, Button, Collapse } from 'antd';
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { BuildStepState } from '@/kernel/pipeline/buildSteps';
import { computeBuildPercent } from '@/kernel/pipeline/buildSteps';

const { Text, Paragraph } = Typography;

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m > 0) return `${m}:${String(rem).padStart(2, '0')}`;
  return `${s} 秒`;
}

function stepIcon(status: BuildStepState['status']) {
  if (status === 'process') return <LoadingOutlined />;
  if (status === 'finish') return <CheckCircleOutlined style={{ color: 'var(--ok)' }} />;
  if (status === 'error') return <CloseCircleOutlined style={{ color: 'var(--danger)' }} />;
  return <ClockCircleOutlined style={{ opacity: 0.35 }} />;
}

function ProgressHero({ percent }: { percent: number }) {
  return (
    <div className="build-progress-hero">
      <div className="build-progress-ring" style={{ ['--p' as string]: `${percent}%` }}>
        <span className="build-progress-ring-value">{percent}%</span>
      </div>
      <div>
        <Text className="build-progress-title">正在生成 Word</Text>
        <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
          Pandoc · 文档结构 · OOXML 样式，请勿关闭本页
        </Paragraph>
      </div>
    </div>
  );
}

export interface BuildProgressModalProps {
  open: boolean;
  steps: BuildStepState[];
  logs: string[];
  startedAt: number | null;
  statusMessage?: string;
  canCancel?: boolean;
  onCancel?: () => void;
}

export const BuildProgressModal: React.FC<BuildProgressModalProps> = ({
  open,
  steps,
  logs,
  startedAt,
  statusMessage,
  canCancel = true,
  onCancel,
}) => {
  const [now, setNow] = useState(Date.now());
  const percent = useMemo(() => computeBuildPercent(steps), [steps]);
  const currentIdx = steps.findIndex((s) => s.status === 'process');
  const elapsed = startedAt ? now - startedAt : 0;
  const tailLogs = logs.slice(-80);

  useEffect(() => {
    if (!open || !startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [open, startedAt]);

  return (
    <Modal
      open={open}
      title={null}
      footer={null}
      closable={false}
      maskClosable={false}
      keyboard={false}
      centered
      width={520}
      className="build-progress-modal"
      destroyOnHidden
    >
      <ProgressHero percent={percent} />
      <div className="build-progress-body">
        <Progress
          percent={percent}
          status={percent >= 100 ? 'success' : 'active'}
          strokeColor={{ from: '#3b82f6', to: '#6366f1' }}
          trailColor="rgba(99, 102, 241, 0.12)"
          showInfo={false}
          strokeWidth={8}
        />
        <div className="build-progress-meta">
          <Text type="secondary">
            <ClockCircleOutlined /> {formatElapsed(elapsed)}
          </Text>
          {statusMessage ? (
            <Text type="secondary" ellipsis style={{ maxWidth: 260 }}>
              {statusMessage}
            </Text>
          ) : (
            percent < 100 && (
              <Text type="secondary" className="build-progress-pulse">
                处理中…
              </Text>
            )
          )}
        </div>
        <Steps
          direction="vertical"
          size="small"
          current={currentIdx >= 0 ? currentIdx : steps.length}
          className="build-progress-steps"
          items={steps.map((s) => ({
            title: s.label,
            description: s.message ?? s.description,
            status:
              s.status === 'error'
                ? 'error'
                : s.status === 'finish'
                  ? 'finish'
                  : s.status === 'process'
                    ? 'process'
                    : 'wait',
            icon: stepIcon(s.status),
          }))}
        />
        {tailLogs.length > 0 && (
          <Collapse
            ghost
            size="small"
            className="build-progress-log"
            items={[
              {
                key: 'log',
                label: `实时日志（${logs.length} 行）`,
                children: <pre className="build-progress-log-pre">{tailLogs.join('\n')}</pre>,
              },
            ]}
          />
        )}
        {canCancel && onCancel && (
          <div className="build-progress-actions">
            <Button danger type="text" onClick={onCancel}>
              取消构建
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
