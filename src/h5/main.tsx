import { createRoot } from 'react-dom/client';
import { configureApiClientAuth, configureApiClientPaths } from '@/lib/api/apiClient';
import { readSessionToken } from './lib/auth';
import { applyHostAttributes } from './lib/host';
import App from './App';
import '@/app/globals.css';

// 宿主形态探测（dsh / browser）：挂 <html data-host>，CSS 与组件按形态分化
applyHostAttributes();

// H5 宿主：API 走插件前缀，401 回到 hash 登录页
configureApiClientPaths({ apiPrefix: '/s', loginPath: '/s/app/#/login' });

// dsh-app:// 壳里 cookie 会被 Electron 主进程抹掉，所有数据请求都要自带令牌头
configureApiClientAuth(() => {
  const token = readSessionToken();
  return token ? { authorization: `Bearer ${token}` } : null;
});

// PWA：仅插件宿主下注册 SW（开发预览端口不注册，避免缓存干扰）
if ('serviceWorker' in navigator && window.location.pathname.startsWith('/s/app')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/s/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(<App />);
