'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { fetchSession, type H5Session } from './lib/auth';
import { navigateTo, useHashPath } from './lib/router';
import H5LoginPage from './pages/LoginPage';
import H5SettingsPage from './pages/SettingsPage';

// 路由级 code splitting：移动端首屏只载当前视图 bundle
const GovernanceConsole = lazy(() => import('@/features/governance/components/GovernanceConsole'));
const TrendingConsole = lazy(() => import('@/features/trending/components/TrendingConsole'));
const StudioConsole = lazy(() => import('@/features/studio/components/StudioConsole'));
const H5ReaderPage = lazy(() => import('./pages/ReaderPage'));
const H5AssistantPage = lazy(() => import('./pages/AssistantPage'));

/** 「问 AI」浮动入口：审批台/热点页右上角常驻，跳 #/assistant（K4 指挥台）。 */
function AskAiEntry() {
  return (
    <button
      type="button"
      aria-label="问 AI"
      onClick={() => navigateTo('/assistant')}
      className="fixed right-4 top-4 z-50 rounded-full border bg-card/90 px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur-md"
    >
      🦸 问 AI
    </button>
  );
}

function ViewLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
    </div>
  );
}

/**
 * H5 应用壳：hash 路由 + 鉴权门。
 * 路由：#/reader（默认）#/governance #/trending #/studio #/settings #/login
 */
export default function App() {
  const path = useHashPath();
  const route = path.split('?')[0] || '/reader';
  const [session, setSession] = useState<H5Session | null>(null);

  useEffect(() => {
    void fetchSession().then(setSession);
  }, []);

  // 鉴权门：未登录一律去登录页
  useEffect(() => {
    if (session && !session.authenticated && route !== '/login') {
      navigateTo('/login');
    }
  }, [session, route]);

  if (route === '/login') {
    return <H5LoginPage />;
  }

  if (session === null) {
    return <ViewLoading />;
  }

  if (!session.authenticated) {
    return null; // 重定向中
  }

  let view: React.ReactNode;
  switch (route) {
    case '/governance':
      view = <GovernanceConsole />;
      break;
    case '/trending':
      view = <TrendingConsole />;
      break;
    case '/studio':
      view = <StudioConsole />;
      break;
    case '/settings':
      view = <H5SettingsPage username={session.username} />;
      break;
    case '/assistant':
      view = <H5AssistantPage />;
      break;
    case '/':
    case '/reader':
    default:
      view = <H5ReaderPage />;
      break;
  }

  return (
    <>
      {(route === '/governance' || route === '/trending') && <AskAiEntry />}
      <Suspense fallback={<ViewLoading />}>{view}</Suspense>
    </>
  );
}
