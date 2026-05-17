import React, { useEffect } from 'react';
import { Layout, Menu, Spin, Alert, Badge } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getNavFeatures, getFeatureByPath } from '@/platform/registry';
import { resolveFeatureIcon } from '@/platform/iconMap';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';

const { Header, Content, Sider } = Layout;

export const AppShell: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const bootstrap = useAppStore((s) => s.bootstrap);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const initWorkspace = useEditorStore((s) => s.initWorkspace);
  const dirtyCount = useEditorStore((s) => Object.values(s.dirty).filter(Boolean).length);

  const currentFeature = getFeatureByPath(location.pathname);
  const selectedKey = currentFeature?.path ?? '/export';

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!loading && useAppStore.getState().config) {
      void initWorkspace();
    }
  }, [loading, initWorkspace]);

  return (
    <Layout className="app-shell">
      <Sider width={220} className="app-sider" breakpoint="lg" collapsedWidth={64}>
        <div className="app-brand">
          <FileTextOutlined style={{ fontSize: 22 }} />
          <span>WordEditor</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={getNavFeatures().map((f) => ({
            key: f.path,
            icon: resolveFeatureIcon(f.icon),
            label: f.label,
          }))}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <span className="app-header-title">
            {currentFeature?.label ?? 'WordEditor'}
          </span>
          {dirtyCount > 0 && (
            <Badge count={dirtyCount} style={{ marginLeft: 12 }} title="未保存文件" />
          )}
        </Header>
        <Content className="app-content">
          {loading && (
            <div className="app-loading">
              <Spin size="large" tip="加载项目资源…" />
            </div>
          )}
          {error && (
            <Alert
              type="warning"
              showIcon
              message="无法连接开发 API"
              description={`${error} — 请使用 pnpm dev 启动。`}
              style={{ marginBottom: 16 }}
            />
          )}
          {!loading && <Outlet />}
        </Content>
      </Layout>
    </Layout>
  );
};
