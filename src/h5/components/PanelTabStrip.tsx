'use client';

import { Bell, BookOpen, Flame, Compass, PenLine, Plus, User } from 'lucide-react';
import { useGovernanceQueueSize } from '@/features/governance/hooks/useGovernanceQueueSize';
import { useUnreadNotificationCount } from '@/features/notifications/useUnreadNotificationCount';
import { cn } from '@/lib/utils';
import { navigateTo, useHashPath } from '../lib/router';

interface PanelTabStripProps {
  /** 打开粘贴收藏面板 */
  onOpenPaste?: () => void;
}

/**
 * DSH 宿主形态的面板内顶部导航条（data-host='dsh' 时替代 H5TabBar/DesktopRail）。
 *
 * 为什么不用宿主 slot 当导航：client 半注册的顶部按钮是发给 Agent 的快捷指令，
 * 不是路由导航；把五 tab 塞进 DSH 侧栏要绑 slots API（alpha，破坏性变更风险），
 * 而面板内自含导航在内嵌 iframe 和独立窗口里行为一致。
 * 样式与 H5TabBar 同源（玻璃底 + badge），只是从底部竖排改为顶部横排、更紧凑。
 */
export default function PanelTabStrip({ onOpenPaste }: PanelTabStripProps) {
  const pathname = useHashPath();
  const route = pathname.split('?')[0];
  const queueSize = useGovernanceQueueSize();
  const unreadNotifications = useUnreadNotificationCount();

  const isStudio = route === '/studio' || route === '/governance';

  const items = [
    { key: '/discover', label: '订阅', to: '/discover', Icon: Compass, active: route === '/discover' || route === '/', badge: 0 },
    { key: '/trending', label: '热点', to: '/trending', Icon: Flame, active: route === '/trending', badge: 0 },
    { key: '/reader', label: '收藏', to: '/reader', Icon: BookOpen, active: route === '/reader', badge: 0 },
    { key: '/studio', label: '创作', to: '/studio', Icon: PenLine, active: isStudio, badge: queueSize },
    { key: '/notifications', label: '消息', to: '/notifications', Icon: Bell, active: route === '/notifications', badge: unreadNotifications },
    { key: '/profile', label: '我的', to: '/profile', Icon: User, active: route === '/profile', badge: 0 },
  ] as const;

  const tabClass = (active: boolean) =>
    cn(
      'relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1',
      'font-mono text-[10px] transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
      active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <nav
      data-testid="panel-tab-strip"
      aria-label="面板导航"
      className="glass-surface-strong sticky top-0 z-40 flex h-12 items-stretch border-b border-border/60"
    >
      {/* 宽面板下导航收拢居中，不随面板宽度无限摊开 */}
      <div className="mx-auto flex h-full w-full max-w-3xl items-stretch">
        {items.map(({ key, label, to, Icon, active, badge }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigateTo(to)}
            className={tabClass(active)}
          >
            <span
              aria-hidden="true"
              className={cn('absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary transition-opacity', active ? 'opacity-100' : 'opacity-0')}
            />
            <span className="relative">
              <Icon aria-hidden="true" className="h-4 w-4" />
              {badge > 0 ? (
                <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-semibold tabular-nums text-warning-foreground">
                  {badge > 99 ? '99+' : badge}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">{label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label="添加收藏"
          onClick={onOpenPaste}
          className={cn(
            'flex h-full w-12 shrink-0 items-center justify-center border-l border-border/60 text-primary transition-colors',
            'hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
          )}
        >
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
}
