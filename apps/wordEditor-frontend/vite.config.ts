import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDevApiMiddleware } from './server/dev-api';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'wordeditor-dev-api',
      configureServer(server) {
        server.middlewares.use('/api', createDevApiMiddleware());
      },
    },
  ],
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
    port: 5173,
    open: true,
  },
});
