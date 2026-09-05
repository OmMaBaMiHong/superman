'use client';

import { useEffect } from 'react';

/**
 * PWA service worker 注册：仅生产环境注册（开发环境注册会缓存旧 bundle，干扰热更新）。
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败不影响主流程
    });
  }, []);

  return null;
}
