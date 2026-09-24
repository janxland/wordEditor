import React, { useEffect, useState } from 'react';
import { Badge, Popover, Space, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { EngineId, apiBase, getEngine, setEngine } from '@/core/engine';

const { Text } = Typography;

interface EngineDef {
  id: EngineId;
  label: string;
  healthPath: string;
  startCmd: string;
}

const ENGINES: EngineDef[] = [
  {
    id: 'node',
    label: 'Node · 8787',
    healthPath: '/api/health',
    startCmd: 'pnpm --dir services/api-node dev',
  },
  {
    id: 'python',
    label: 'Python · 8788',
    healthPath: '/py-api/health',
    startCmd: 'python -m uvicorn app:app --app-dir services/api-python --port 8788',
  },
];

async function probeEngine(e: EngineDef): Promise<string | null> {
  try {
    const res = await fetch(e.healthPath, { signal: AbortSignal.timeout(3000) });
    const j = (await res.json()) as { ok?: boolean; service?: string };
    return j?.ok ? j.service ?? e.id : null;
  } catch {
    return null;
  }
}

export const EngineSwitch: React.FC = () => {
  const engine = getEngine();
  const [health, setHealth] = useState<Record<EngineId, string | null>>({
    node: null,
    python: null,
  });

  const probeAll = () => {
    void Promise.all(ENGINES.map(probeEngine)).then(([node, python]) =>
      setHealth({ node, python }),
    );
  };

  useEffect(probeAll, []);

  const switchTo = (id: EngineId) => {
    if (id === engine) return;
    setEngine(id);
    window.location.reload();
  };

  const content = (
    <Space direction="vertical" size={4} style={{ minWidth: 280 }}>
      {ENGINES.map((e) => {
        const active = e.id === engine;
        const up = health[e.id];
        return (
          <div
            key={e.id}
            onClick={() => switchTo(e.id)}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              cursor: active ? 'default' : 'pointer',
              background: active ? 'var(--bg)' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge status={up ? 'success' : 'error'} />
              <Text strong={active}>{e.label}</Text>
              <Text type="secondary" style={{ marginLeft: 'auto', fontSize: 12 }}>
                {active ? '当前引擎' : up ? '点击切换' : '未启动'}
              </Text>
            </div>
            {!up && (
              <Text code style={{ fontSize: 11 }}>
                {e.startCmd}
              </Text>
            )}
          </div>
        );
      })}
      <Text type="secondary" style={{ fontSize: 12 }}>
        两引擎接口契约一致，产物闭环等价；代理前缀 {apiBase()}
      </Text>
    </Space>
  );

  return (
    <Popover content={content} title="后端引擎（调试）" trigger="click" placement="bottomRight">
      <SettingOutlined style={{ fontSize: 18, cursor: 'pointer', color: '#475569' }} />
    </Popover>
  );
};
