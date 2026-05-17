import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerAppFeatures } from '@/platform/registerFeatures';
import 'antd/dist/reset.css';

registerAppFeatures();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
