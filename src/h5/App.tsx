'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch, fetchSession, signInWithHost, writeSessionToken, type H5Session } from './lib/auth';
import { HOST } from './lib/host';
import { navigateTo, useHashPath } from './lib/router';
import { ToastHost } from '@/features/toast/components/ToastHost';
import H5DesktopRail from './components/DesktopRail';
import H5TabBar from './components/H5TabBar';
import PanelTabStrip from './components/PanelTabStrip';
import AddSheet from './components/AddSheet';
import H5LoginPage from './pages/LoginPage';

const StudioConsole = lazy(() => import('@/features/studio/components/StudioConsole'));
const H5ReaderPage = lazy(() => import('./pages/ReaderPage'));
const H5DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
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
  const route = path.split('?')[0] || '/discover';
  const [session, setSession] = useState<H5Session | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  // Chaos 数据中台授权提示（DSH 宿主）：未绑定则每次冷进入提示一次，可跳过（本会话不再打扰）
  const [chaosPrompt, setChaosPrompt] = useState(false);
  const dismissChaosPrompt = useCallback(() => {
    try {
      sessionStorage.setItem('superman.chaosPrompt', 'skip');
    } catch {
      // 忽略
    }
    setChaosPrompt(false);
  }, []);
  const connectChaos = useCallback(() => {
    void (async () => {
      try {
        const res = await apiFetch('/s/api/chaos/auth/start');
        const json = (await res.json()) as { ok?: boolean; data?: { authorizationUrl?: string } };
        if (json.ok && json.data?.authorizationUrl) {
          window.location.href = json.data.authorizationUrl;
          return;
        }
      } catch {
        // 中台未配置或不可用：不再提示
      }
      dismissChaosPrompt();
    })();
  }, [dismissChaosPrompt]);
  useEffect(() => {
    if (HOST !== 'dsh' || !session?.authenticated) return undefined;
    if (sessionStorage.getItem('superman.chaosPrompt') === 'skip') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/s/api/chaos/auth/me');
        const json = (await res.json()) as { ok?: boolean; data?: { linked?: boolean } };
        if (!cancelled && json.ok && !json.data?.linked) setChaosPrompt(true);
      } catch {
        // 探测失败不提示
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.authenticated]);

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

  // DSH 宿主：每次面板打开都强制落「订阅」（/discover，默认热点新闻子 tab）。
  // iframe 每次打开都是全新加载，不存在"恢复上次位置"的诉求；上次停在哪都拉回订阅。
  useEffect(() => {
    if (HOST !== 'dsh' || !session?.authenticated) return;
    if (route !== '/discover') navigateTo('/discover');
  }, [session?.authenticated]);

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
      navigateTo('/discover');
      return <ViewLoading />;
    }
    // 桌面插件形态：无登录页——本机身份无感自动创建（宿主身份优先，游客兜底），
    // 中转站登录在进入后的「我的页」完成（Skoob 模式：注册在中转站侧，插件只登录+存令牌）。
    if (HOST === 'dsh') {
      return <DshAutoEntry onSignedIn={setSession} />;
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
    // 热点已并入订阅页（子 tab「热点新闻」）：老路由 302 式收敛，避免外链/收藏失效
    navigateTo('/discover?tab=hot');
    return <ViewLoading />;
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
  } else if (route === '/discover') {
    // 订阅页子 tab：hot=热点新闻 / github=GitHub / dsh=DSH 插件（缺省落在 RSS 发现流）
    const subTab = tabParam === 'hot' || tabParam === 'github' || tabParam === 'dsh' ? tabParam : undefined;
    view = <H5DiscoverPage initialTab={subTab} />;
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
      {chaosPrompt ? (
        <div
          role="status"
          className="fixed inset-x-3 bottom-4 z-40 flex items-center gap-2 rounded-2xl border border-primary/30 bg-card/95 px-4 py-3 shadow-lg backdrop-blur-md md:inset-x-auto md:right-6 md:w-[26rem]"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-foreground">绑定数据中台账号</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              绑定后推荐与素材行为带你的中台身份；跳过也不影响本地使用。
            </p>
          </div>
          <button
            type="button"
            onClick={connectChaos}
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-3 text-[11px] font-medium text-primary transition-all duration-150 hover:bg-primary/20"
          >
            去授权
          </button>
          <button
            type="button"
            aria-label="跳过"
            onClick={dismissChaosPrompt}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <AddSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
      <ToastHost />
    </>
  );
}

/**
 * DSH 桌面端无感进入：宿主身份（DeepSeek 账号）优先，失败回退本机游客身份——
 * 本地身份只管本地数据归属；创作/素材能力由中转站登录解锁（我的页完成）。
 */
function DshAutoEntry({ onSignedIn }: { onSignedIn: (session: H5Session) => void }) {
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    void (async () => {
      try {
        if (await signInWithHost()) {
          onSignedIn(await fetchSession());
          navigateTo('/discover');
          return;
        }
      } catch {
        // 宿主身份不可用 → 走游客兜底
      }
      try {
        const res = await apiFetch('/s/api/auth/guest-session', { method: 'POST' });
        if (!res.ok) throw new Error('guest session failed');
        const json = (await res.json()) as { ok?: boolean; data?: { token?: string; username?: string } };
        // DSH 壳里 cookie 进不来：游客令牌必须显式写入本地存储（与登录同款）
        if (!json?.ok || !json.data?.token) throw new Error('guest session missing token');
        writeSessionToken(json.data.token);
        onSignedIn({ authenticated: true, username: json.data.username ?? 'dsh-local' });
        navigateTo('/discover');
      } catch {
        setError('本机身份初始化失败，请重试');
      }
    })();
  }, [onSignedIn]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p role="alert" className="text-sm text-error">{error}</p>
        <button
          type="button"
          onClick={() => { attemptedRef.current = false; setError(null); }}
          className="rounded-full border border-border px-5 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          重试
        </button>
      </div>
    );
  }
  return <ViewLoading />;
}

export default App;
