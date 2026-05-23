import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AppRouter } from '@/app/routes';
import './App.css';

const App: React.FC = () => (
  <ConfigProvider
    locale={zhCN}
    theme={{
      algorithm: theme.defaultAlgorithm,
      token: {
        colorPrimary: '#4f46e5',
        borderRadius: 8,
      },
    }}
  >
    <AntApp notification={{ placement: 'bottomRight', maxCount: 3 }}>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </AntApp>
  </ConfigProvider>
);

export default App;
