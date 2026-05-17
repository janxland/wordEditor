import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { getFeatures } from '@/platform/registry';
import { AppShell } from './AppShell';

const PageFallback = () => (
  <div className="page-fallback">
    <Spin size="large" />
  </div>
);

export const AppRouter: React.FC = () => {
  const features = getFeatures();

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          {features.map((f) => {
            const Page = f.lazy;
            return <Route key={f.id} path={f.path} element={<Page />} />;
          })}
          <Route path="*" element={<Navigate to="/export" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
};
