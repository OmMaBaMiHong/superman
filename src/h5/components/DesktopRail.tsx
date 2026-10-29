'use client';

import { Bell, BookOpen, Flame, PenLine, Plus, User } from 'lucide-react';
import { useGovernanceQueueSize } from '@/features/governance/hooks/useGovernanceQueueSize';
import { useUnreadNotificationCount } from '@/features/notifications/useUnreadNotificationCount';
import { cn } from '@/lib/utils';
import { navigateTo, useHashPath } from '../lib/router';

interface H5DesktopRailProps {
  onOpenPaste?: () => void;
}

/**
 * H5 桌面端导航 rail：收藏 / 创作 / (+) / 消息 / 我的。
 */
export default function H5DesktopRail({ onOpenPaste }: H5DesktopRailProps) {
  const pathname = useHashPath();
  const route = pathname.split('?')[0];
  const queueSize = useGovernanceQueueSize();
  const unreadNotifications = useUnreadNotificationCount();

  const items: Array<{ path: string; label: string; Icon: typeof Bell; badge: number }> = [
    { path: '/reader', label: '随记', Icon: BookOpen, badge: 0 },
    { path: '/studio', label: '创作', Icon: PenLine, badge: queueSize },
    { path: '/notifications', label: '消息', Icon: Bell, badge: unreadNotifications },
    { path: '/profile', label: '我的', Icon: User, badge: 0 },
  ];

  return (
    <nav
      data-testid="desktop-rail"
      aria-label="主导航（桌面）"
      className="glass-surface-strong fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-2 rounded-[24px] p-2 md:flex"
    >
      {items.map((item) => {
        const active = route === item.path || (item.path === '/studio' && route === '/governance');
        return (
          <button
            key={item.path}
            type="button"
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            title={item.label}
            onClick={() => navigateTo(item.path)}
            className={cn(
              'relative flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <item.Icon aria-hidden="true" className="h-5 w-5" />
            {item.badge > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-semibold tabular-nums text-warning-foreground">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </button>
        );
      })}

      {/* 中间 + 按钮 */}
      <button
        type="button"
        data-testid="desktop-rail-paste"
        aria-label="添加收藏"
        title="添加收藏"
        onClick={onOpenPaste}
        className={cn(
          'relative flex h-11 w-11 items-center justify-center rounded-full transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/30 hover:scale-105 hover:shadow-lg hover:shadow-primary/40 active:scale-95',
        )}
      >
        <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </nav>
  );
}
