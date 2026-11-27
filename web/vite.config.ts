import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const apiTarget = `http://127.0.0.1:${process.env.PCOP_PORT || 3333}`;

export default defineConfig({
  root: webRoot,
  base: '/admin/assets/',
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: '../src/public',
    emptyOutDir: true,
    assetsDir: 'static',
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/admin/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', apiTarget);
          });
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
