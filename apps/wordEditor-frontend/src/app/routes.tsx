import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { getFeatures } from '@/platform/registry';
import { canAccess } from '@/platform/registry';
import { isWorker, isAdmin } from '@/services/docOrder';
import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { AppShell } from './AppShell';

const PageFallback = () => (
  <div className="page-fallback">
    <Spin size="large" />
  </div>
);

/** 路由级角色守卫：导航隐藏之外，直接敲 URL 也进不来（重定向回落地页） */
const RoleGate: React.FC<{
  access: 'public' | 'worker' | 'admin';
  children: React.ReactNode;
}> = ({ access, children }) => {
  const me = useCurrentUser();
  const allowed = canAccess(access, { isWorker: isWorker(me), isAdmin: isAdmin(me) });
  if (allowed) return <>{children}</>;
  return <Navigate to="/" replace />;
};

export const AppRouter: React.FC = () => {
  const features = getFeatures();

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          {features.map((f) => {
            const Page = f.lazy;
            return (
              <Route
                key={f.id}
                path={f.path}
                element={
                  <RoleGate access={f.access ?? 'public'}>
                    <Page />
                  </RoleGate>
                }
              />
            );
          })}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
};
