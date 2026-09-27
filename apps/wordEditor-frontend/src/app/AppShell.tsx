import React, { useEffect, useState } from 'react';
import { Layout, Menu, Spin, Alert, Badge, Button, Modal, Space, Tag } from 'antd';
import { FileTextOutlined, LoginOutlined, LogoutOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getNavGroups, getFeatureByPath, canAccessFeature } from '@/platform/registry';
import { resolveFeatureIcon } from '@/platform/iconMap';
import { AuthForm } from '@/components/auth/AuthForm';
import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { EngineSwitch } from '@/components/settings/EngineSwitch';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { logout, isWorker, isAdmin } from '@/services/docOrder';
import { onUnauthorized } from '@/services/apiFetch';

const { Header, Content, Sider } = Layout;

export const AppShell: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const bootstrap = useAppStore((s) => s.bootstrap);
  const rebootstrap = useAppStore((s) => s.rebootstrap);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const initWorkspace = useEditorStore((s) => s.initWorkspace);
  const dirtyCount = useEditorStore((s) => Object.values(s.dirty).filter(Boolean).length);
  const me = useCurrentUser();
  const [loginOpen, setLoginOpen] = useState(false);

  // 接口回 401（没登录 / token 过期）就弹登录，别让用户对着一串报错猜
  useEffect(() => onUnauthorized(() => setLoginOpen(true)), []);

  const currentFeature = getFeatureByPath(location.pathname);
  const selectedKey = currentFeature?.path ?? '/';

  // 首页是纯落地页，不需要任何 API；别的页面才拉配置。
  // 这个 effect 同时覆盖两种时机：进入应用（mount/切出落地页）与登录态变化（登录前那次多半 401 失败）。
  const isLanding = location.pathname === '/';

  useEffect(() => {
    if (isLanding) return;
    if (useAppStore.getState().config) void bootstrap();
    else void rebootstrap();
  }, [me, isLanding, bootstrap, rebootstrap]);

  useEffect(() => {
    if (!loading && !isLanding && useAppStore.getState().config) {
      void initWorkspace();
    }
  }, [loading, isLanding, initWorkspace]);

  return (
    <Layout className="app-shell">
      {/* 首页是纯落地页：不显示侧边导航，下单后才进入带导航的应用界面 */}
      {!isLanding && (
        <Sider width={220} className="app-sider" breakpoint="lg" collapsedWidth={64}>
          <div className="app-brand">
            <FileTextOutlined style={{ fontSize: 22 }} />
            <span>WordEditor</span>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={getNavGroups()
              // 按角色过滤：下单人只见 public 功能；制作工具需制作员；关于需超管
              .map((g) => ({
                ...g,
                items: g.items.filter((f) => canAccessFeature(f, { isWorker: isWorker(me), isAdmin: isAdmin(me) })),
              }))
              .filter((g) => g.items.length > 0)
              .map((g) => ({
              key: g.key,
              type: 'group' as const,
              label: g.label,
              children: g.items.map((f) => ({
                key: f.path,
                icon: resolveFeatureIcon(f.icon),
                label: f.label,
              })),
            }))}
            onClick={({ key }) => navigate(key)}
          />
        </Sider>
      )}
      <Layout>
        {isLanding ? (
          /* 落地页沉浸式头部：透明悬浮、只留品牌与登录，不带工作台的实心栏与引擎切换 */
          <Header className="app-header app-header-landing">
            <span className="app-header-title app-header-brand">
              <FileTextOutlined /> WordEditor
            </span>
            <span style={{ marginLeft: 'auto' }}>
              {!me && (
                <Button type="text" icon={<LoginOutlined />} onClick={() => setLoginOpen(true)}>
                  登录
                </Button>
              )}
            </span>
          </Header>
        ) : (
          <Header className="app-header">
            <span className="app-header-title">
              {currentFeature?.label ?? 'WordEditor'}
            </span>
            {dirtyCount > 0 && (
              <Badge count={dirtyCount} style={{ marginLeft: 12 }} title="未保存文件" />
            )}
            <span style={{ marginLeft: 'auto' }}>
              <Space size={8}>
                {me ? (
                  <>
                    <Tag color="blue">{me.username}</Tag>
                    <Button
                      type="text"
                      icon={<LogoutOutlined />}
                      onClick={() => logout()}
                      aria-label="退出登录"
                    />
                  </>
                ) : (
                  <Button icon={<LoginOutlined />} onClick={() => setLoginOpen(true)}>
                    登录
                  </Button>
                )}
                <EngineSwitch />
              </Space>
            </span>
          </Header>
        )}
        <Content className={isLanding ? 'app-content app-content-landing' : 'app-content'}>
          {loading && (
            <div className="app-loading">
              <Spin size="large" tip="加载项目资源…">
                <div style={{ minWidth: 220, minHeight: 48 }} />
              </Spin>
            </div>
          )}
          {!loading && !error && <Outlet />}
          {!loading && error && isLanding && <Outlet />}
          {!loading && error && !isLanding && (
            <>
              <Alert
                type={me ? 'warning' : 'info'}
                showIcon
                message={me ? '无法连接开发 API' : '登录后才能读取模板'}
                description={me ? `${error} — 请使用 pnpm dev 启动。` : error}
                action={
                  me ? undefined : (
                    <Button size="small" onClick={() => setLoginOpen(true)}>
                      登录
                    </Button>
                  )
                }
                style={{ marginBottom: 16 }}
              />
              <Outlet />
            </>
          )}
        </Content>
      </Layout>

      <Modal
        open={loginOpen && !me}
        onCancel={() => setLoginOpen(false)}
        footer={null}
        title="登录 WordEditor"
        width={380}
        destroyOnHidden
      >
        <p style={{ marginTop: 0, color: '#6b7a90', fontSize: 12 }}>
          导出、导入、样式预览都要登录；改模板需要制作员角色。
        </p>
        <AuthForm onAuthed={() => setLoginOpen(false)} />
      </Modal>
    </Layout>
  );
};
