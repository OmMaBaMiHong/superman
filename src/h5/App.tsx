'use client';

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { fetchSession, signInWithHost, type H5Session } from './lib/auth';
import { HOST } from './lib/host';
import { navigateTo, useHashPath } from './lib/router';
import { ToastHost } from '@/features/toast/components/ToastHost';
import H5DesktopRail from './components/DesktopRail';
import H5TabBar from './components/H5TabBar';
import PanelTabStrip from './components/PanelTabStrip';
import AddSheet from './components/AddSheet';
import H5LoginPage from './pages/LoginPage';

const TrendingConsole = lazy(() => import('@/features/trending/components/TrendingConsole'));
const StudioConsole = lazy(() => import('@/features/studio/components/StudioConsole'));
const H5ReaderPage = lazy(() => import('./pages/ReaderPage'));
const H5NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const H5ProfilePage = lazy(() => import('./pages/ProfilePage'));
const H5RemakePage = lazy(() => import('./pages/RemakePage'));

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

function App() {
  const path = useHashPath();
  const route = path.split('?')[0] || '/reader';
  const [session, setSession] = useState<H5Session | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next = await fetchSession();
      // DSH 宿主免登录：本机令牌失效时用宿主 DeepSeek 身份静默换会话，
      // 成功则永不落地到口令登录页；browser 宿主保持原行为。
      if (!next.authenticated && HOST === 'dsh') {
        if (await signInWithHost()) next = await fetchSession();
      }
      if (!cancelled) setSession(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session && !session.authenticated && route !== '/login') {
      navigateTo('/login');
    }
  }, [session, route]);

  const openPaste = useCallback(() => {
    setPasteOpen(true);
  }, []);

  // 任意页面（如阅读页头部「添加」按钮）都可唤起统一添加弹窗
  useEffect(() => {
    const open = () => setPasteOpen(true);
    window.addEventListener('superman:open-add', open);
    return () => window.removeEventListener('superman:open-add', open);
  }, []);

  if (route === '/login') {
    // 登录页是无条件渲染的，所以只要 hash 停在 /login，会话即使有效也永远出不去
    // （DSH 桌面端内嵌在 dsh-app:// 里时踩过：session 已经 authenticated，页面却卡在登录页）。
    // 已经登录就别再要口令，直接把路由推回应用内，自愈。
    if (session?.authenticated === true) {
      navigateTo('/reader');
      return <ViewLoading />;
    }
    // DSH 宿主：口令登录页之上提供「用 DeepSeek 账号进入」一键通道
    // （覆盖宿主稍后才登录 DeepSeek、或宿主会话被作废后重进的情况）。
    if (HOST === 'dsh') {
      return <DshLoginFallback onSignedIn={setSession} />;
    }
    return <H5LoginPage />;
  }

  if (session === null) {
    return <ViewLoading />;
  }

  if (!session.authenticated) {
    return null;
  }

  if (route === '/governance') {
    navigateTo('/studio?tab=queue');
    return <ViewLoading />;
  }

  if (route === '/settings') {
    navigateTo('/profile');
    return <ViewLoading />;
  }

  let view: React.ReactNode = null;
  const tabParam = path.includes('?') ? new URLSearchParams(path.split('?')[1]).get('tab') : null;

  if (route === '/trending') {
    view = <TrendingConsole />;
  } else if (route === '/studio') {
    const studioTab =
      tabParam === 'queue' || tabParam === 'topics' || tabParam === 'jobs' || tabParam === 'drafts' || tabParam === 'plans' || tabParam === 'performance'
        ? tabParam
        : undefined;
    view = <StudioConsole initialSection={studioTab} />;
  } else if (route === '/remake') {
    view = <H5RemakePage />;
  } else if (route === '/notifications') {
    view = <H5NotificationsPage />;
  } else if (route === '/profile') {
    view = <H5ProfilePage username={session.username} />;
  } else {
    view = <H5ReaderPage />;
  }

  return (
    <>
      {(route === '/studio' || route === '/trending') && <AskAiEntry />}
      {HOST === 'dsh' ? (
        // DSH 宿主：宿主已有全局侧栏，H5 自带的悬浮 Rail / 底部 TabBar 反而重复压内容，
        // 换成面板内顶部标签条（独立窗口里同样成立）。
        <PanelTabStrip onOpenPaste={openPaste} />
      ) : (
        <>
          <H5DesktopRail onOpenPaste={openPaste} />
          <H5TabBar onOpenPaste={openPaste} />
        </>
      )}
      <Suspense fallback={<ViewLoading />}>{view}</Suspense>
      <AddSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
      <ToastHost />
    </>
  );
}

/**
 * DSH 宿主的登录兜底页：口令登录页之上悬浮「用 DeepSeek 账号进入」一键通道。
 * 覆盖宿主稍后才登录 DeepSeek、或宿主会话被作废后重进的情况；通道失败时
 * 底下的口令登录表单仍然可用（原 LoginPage 行为不变）。
 */
function DshLoginFallback({ onSignedIn }: { onSignedIn: (session: H5Session) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tryHost = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (await signInWithHost()) {
        onSignedIn(await fetchSession());
        navigateTo('/reader');
        return;
      }
      setError('未获取到 DeepSeek 登录身份：请先在 DeepSeek 客户端登录，或使用下方账号密码。');
    } finally {
      setBusy(false);
    }
  }, [onSignedIn]);

  return (
    <div className="relative">
      <div
        className="fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={() => void tryHost()}
          disabled={busy}
          className="rounded-full bg-primary px-5 py-2.5 text-xs font-medium text-primary-foreground shadow-lg backdrop-blur-md transition-all hover:brightness-110 disabled:opacity-50"
        >
          {busy ? '正在获取宿主身份…' : '🔑 使用 DeepSeek 账号进入'}
        </button>
        {error ? (
          <p role="alert" className="max-w-md rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-center text-xs text-error backdrop-blur-md">
            {error}
          </p>
        ) : null}
      </div>
      <H5LoginPage />
    </div>
  );
}

export default App;
