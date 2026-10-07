'use client';

import { Bell, BookOpen, PenLine, Plus, User } from 'lucide-react';
import { useGovernanceQueueSize } from '@/features/governance/hooks/useGovernanceQueueSize';
import { useUnreadNotificationCount } from '@/features/notifications/useUnreadNotificationCount';
import { cn } from '@/lib/utils';
import { navigateTo, useHashPath } from '../lib/router';

interface H5TabBarProps {
  /** 打开粘贴收藏面板 */
  onOpenPaste?: () => void;
}

/**
 * H5 移动端底部 tab bar（<768px 显示，桌面端由 md:hidden 隐藏）：
 * 收藏 / 创作 / (+) / 消息 / 我的。中间 "+" 为添加收藏入口。
 */
export default function H5TabBar({ onOpenPaste }: H5TabBarProps) {
  const pathname = useHashPath();
  const route = pathname.split('?')[0];
  const queueSize = useGovernanceQueueSize();
  const unreadNotifications = useUnreadNotificationCount();

  const tabClass = (active: boolean) =>
    cn(
      'relative flex h-full min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5',
      'font-mono text-[10px] transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
      active ? 'text-primary' : 'text-muted-foreground',
    );

  const indicator = (active: boolean) =>
    active ? (
      <span
        aria-hidden="true"
        className="absolute top-0 h-0.5 w-8 rounded-full bg-primary shadow-[0_0_8px_rgb(34_211_238/0.6)]"
      />
    ) : null;

  const isStudio = route === '/studio' || route === '/governance';

  return (
    <nav
      data-testid="h5-tab-bar"
      aria-label="主导航"
      className="fixed inset-x-3 bottom-3 z-40 md:hidden"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <div className="glass-surface-strong flex h-14 items-stretch overflow-hidden rounded-[24px]">
        <button
          type="button"
          aria-label="收藏"
          aria-current={route === '/reader' || route === '/' ? 'page' : undefined}
          onClick={() => navigateTo('/reader')}
          className={tabClass(route === '/reader' || route === '/')}
        >
          {indicator(route === '/reader' || route === '/')}
          <BookOpen aria-hidden="true" className="h-5 w-5" />
          <span>收藏</span>
        </button>

        <button
          type="button"
          aria-label="创作"
          aria-current={isStudio ? 'page' : undefined}
          onClick={() => navigateTo('/studio')}
          className={tabClass(isStudio)}
        >
          {indicator(isStudio)}
          <span className="relative">
            <PenLine aria-hidden="true" className="h-5 w-5" />
            {queueSize > 0 ? (
              <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-semibold tabular-nums text-warning-foreground">
                {queueSize > 99 ? '99+' : queueSize}
              </span>
            ) : null}
          </span>
          <span>创作</span>
        </button>

        {/* 中间 + 按钮 */}
        <button
          type="button"
          data-testid="h5-tab-paste"
          aria-label="添加收藏"
          onClick={onOpenPaste}
          className="relative -mt-4 flex h-14 w-14 shrink-0 flex-col items-center justify-center self-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-90"
        >
          <Plus aria-hidden="true" className="h-7 w-7" strokeWidth={2.5} />
        </button>

        <button
          type="button"
          aria-label="消息"
          aria-current={route === '/notifications' ? 'page' : undefined}
          onClick={() => navigateTo('/notifications')}
          className={tabClass(route === '/notifications')}
        >
          {indicator(route === '/notifications')}
          <span className="relative">
            <Bell aria-hidden="true" className="h-5 w-5" />
            {unreadNotifications > 0 ? (
              <span
                data-testid="notification-badge"
                className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-mono text-[9px] font-semibold tabular-nums text-destructive-foreground"
              >
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            ) : null}
          </span>
          <span>消息</span>
        </button>

        <button
          type="button"
          aria-label="我的"
          aria-current={route === '/profile' ? 'page' : undefined}
          onClick={() => navigateTo('/profile')}
          className={tabClass(route === '/profile')}
        >
          {indicator(route === '/profile')}
          <User aria-hidden="true" className="h-5 w-5" />
          <span>我的</span>
        </button>
      </div>
    </nav>
  );
}
