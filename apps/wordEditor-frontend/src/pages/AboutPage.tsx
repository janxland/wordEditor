import React from 'react';
import { Card, Space, Tag, Timeline, Typography } from 'antd';
import { CHANGELOG, type ChangelogItem } from '@/data/changelog';

const { Title, Text, Paragraph } = Typography;

const KIND_META: Record<ChangelogItem['kind'], { label: string; color: string }> = {
  feat: { label: '新增', color: 'green' },
  fix: { label: '修复', color: 'red' },
  perf: { label: '性能', color: 'blue' },
  refactor: { label: '重构', color: 'purple' },
  docs: { label: '文档', color: 'default' },
};

export const AboutPage: React.FC = () => (
  <div className="about-page">
    <Card>
      <Space direction="vertical" size={4}>
        <Title level={4} style={{ margin: 0 }}>
          WordEditor
        </Title>
        <Text type="secondary">
          Markdown → 学校模板 Word 导出：Node/Fastify 引擎与 Python/FastAPI 引擎产物逐字节对齐，
          零新增第三方依赖（fastify · jszip · @xmldom/xmldom · yaml）。
        </Text>
      </Space>
    </Card>

    <Title level={5} style={{ margin: '24px 0 12px' }}>
      更新日志
    </Title>
    <Timeline
      items={CHANGELOG.map((release) => ({
        key: release.version,
        children: (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space size={8}>
              <Text strong>{release.version}</Text>
              <Text type="secondary">{release.date}</Text>
            </Space>
            {release.summary && (
              <Paragraph type="secondary" style={{ margin: 0 }}>
                {release.summary}
              </Paragraph>
            )}
            <Space direction="vertical" size={6}>
              {release.items.map((item) => {
                const meta = KIND_META[item.kind];
                return (
                  <Space key={item.text} size={8} align="start">
                    <Tag color={meta.color} style={{ minWidth: 44, textAlign: 'center' }}>
                      {meta.label}
                    </Tag>
                    <Text>{item.text}</Text>
                  </Space>
                );
              })}
            </Space>
          </Space>
        ),
      }))}
    />
  </div>
);
