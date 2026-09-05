import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const h5Root = fileURLToPath(new URL('.', import.meta.url));
const srcRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Superman H5（DSH 插件伺服版）构建配置。
 * 产物直接写进 src/plugin/public/app/，build:plugin 原样拷贝进 dist/plugin。
 * base '/s/app/'：所有静态资源以插件路由前缀引用。
 */
export default defineConfig({
  root: h5Root,
  base: '/s/app/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': srcRoot,
      // Next 适配层：复用 src/features 组件时把 next/link、next/navigation 换成 hash 路由 shim
      'next/link': fileURLToPath(new URL('./shims/next-link.tsx', import.meta.url)),
      'next/navigation': fileURLToPath(new URL('./shims/next-navigation.ts', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../plugin/public/app', import.meta.url)),
    // brand/ 等资源来自 src/h5/public（publicDir 在清空后重新拷贝），放心清空旧 hash 产物
    emptyOutDir: true,
    sourcemap: false,
  },
});
