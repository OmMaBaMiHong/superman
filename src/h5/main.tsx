import { createRoot } from 'react-dom/client';
import { configureApiClientPaths } from '@/lib/api/apiClient';
import App from './App';
import '@/app/globals.css';

// H5 宿主：API 走插件前缀，401 回到 hash 登录页
configureApiClientPaths({ apiPrefix: '/s', loginPath: '/s/app/#/login' });

// PWA：仅插件宿主下注册 SW（开发预览端口不注册，避免缓存干扰）
if ('serviceWorker' in navigator && window.location.pathname.startsWith('/s/app')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/s/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(<App />);
