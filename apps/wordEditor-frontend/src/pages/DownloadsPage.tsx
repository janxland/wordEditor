/**
 * 下载中心 —— 仅制作员可见：桌面端安装包等产物的下载入口。
 * 列表来自云端 /api/downloads（服务器 downloads 目录），下载走带 token 的流式接口。
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Table, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';

import { downloadApi, type DownloadItem } from '@/services/docOrder';

const { Title, Text } = Typography;

function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export const DownloadsPage: React.FC = () => {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await downloadApi.list());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doDownload = async (item: DownloadItem): Promise<void> => {
    setBusy(item.name);
    try {
      await downloadApi.download(item);
      message.success(`已开始下载：${item.name}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copyLink = (item: DownloadItem): void => {
    // 直链需要登录 + 制作员权限，复制的是云端站点下载页，让同事自己登录后取
    void navigator.clipboard.writeText(`https://word.roginx.ink/#/downloads`);
    message.success('下载页链接已复制，发给同事登录后即可下载');
  };

  return (
    <div className="downloads-page">
      <Card>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            下载中心
          </Title>
          <Text type="secondary">
            制作人专用：这里提供 WordEditor 做单台桌面端安装包。下载需要制作员登录态，安装包请用最新版本。
          </Text>
        </Space>
      </Card>

      {error && (
        <Alert
          type="warning"
          showIcon
          message="本机列表加载失败"
          description={
            <Space direction="vertical">
              <Text type="secondary">{error}</Text>
              <Button
                size="small"
                type="primary"
                onClick={() => window.open('https://word.roginx.ink/#/downloads')}
              >
                打开云端下载页
              </Button>
            </Space>
          }
          style={{ marginTop: 16 }}
        />
      )}

      {!error && items.length === 0 && !loading && (
        <Alert
          type="info"
          showIcon
          message="暂无可下载文件"
          description="COS 下载中心还没有安装包，站主跑 npm run deploy:releases 传包后刷新本页。"
          style={{ marginTop: 16 }}
        />
      )}

      <Table<DownloadItem>
        style={{ marginTop: 16 }}
        rowKey="name"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          { title: '文件名', dataIndex: 'name', ellipsis: true },
          { title: '大小', key: 'size', width: 110, render: (_, r) => fmtSize(r.size) },
          {
            title: '更新时间',
            dataIndex: 'updateTime',
            width: 180,
            render: (v: string) => new Date(v).toLocaleString('zh-CN'),
          },
          {
            title: '操作',
            key: 'actions',
            width: 220,
            render: (_, r) => (
              <Space>
                <Button
                  type="primary"
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={busy === r.name}
                  onClick={() => void doDownload(r)}
                >
                  下载
                </Button>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(r)}>
                  复制链接
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Button style={{ marginTop: 16 }} icon={<ReloadOutlined />} onClick={() => void load()}>
        刷新
      </Button>
    </div>
  );
};
