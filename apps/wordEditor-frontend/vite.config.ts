import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8787';
  const pyApiTarget = env.VITE_PY_API_TARGET || 'http://localhost:8788';

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            antd: ['antd', '@ant-design/icons'],
            monaco: ['@monaco-editor/react'],
          },
        },
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      open: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        // 调试用 python 引擎：/py-api/* → 8788 的 /api/*
        '/py-api': {
          target: pyApiTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/py-api/, '/api'),
        },
      },
    },
    preview: {
      port: 5174,
      strictPort: true,
    },
  };
});
