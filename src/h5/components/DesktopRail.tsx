'use client';

import { Bell, BookOpen, Flame, PenLine, Settings } from 'lucide-react';
import { useGovernanceQueueSize } from '@/features/governance/hooks/useGovernanceQueueSize';
import { useUnreadNotificationCount } from '@/features/notifications/useUnreadNotificationCount';
import { cn } from '@/lib/utils';
import { navigateTo, useHashPath } from '../lib/router';

/**
 * H5 桌面端导航 rail（≥768px 显示，md 以下隐藏）：
 * 左侧悬浮玻璃条，与移动端底部 tab bar 同五项（阅读/创作/热点/消息/设置），
 * 创作带待批徽章、消息带未读徽章。
 */
export default function H5DesktopRail() {
  const pathname = useHashPath();
  const route = pathname.split('?')[0];
  const queueSize = useGovernanceQueueSize();
  const unreadNotifications = useUnreadNotificationCount();

  const items: Array<{ path: string; label: string; Icon: typeof Bell; badge: number }> = [
    { path: '/reader', label: '阅读', Icon: BookOpen, badge: 0 },
    { path: '/studio', label: '创作', Icon: PenLine, badge: queueSize },
    { path: '/trending', label: '热点', Icon: Flame, badge: 0 },
    { path: '/notifications', label: '消息', Icon: Bell, badge: unreadNotifications },
    { path: '/settings', label: '设置', Icon: Settings, badge: 0 },
  ];

  return (
    <nav
      data-testid="desktop-rail"
      aria-label="主导航（桌面）"
      className="glass-surface-strong fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-1 rounded-[24px] p-2 md:flex"
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
    </nav>
  );
}
