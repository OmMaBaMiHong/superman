'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Flame, Settings, Stamp } from 'lucide-react';
import { useGovernanceQueueSize } from '@/features/governance/hooks/useGovernanceQueueSize';
import { cn } from '@/lib/utils';

interface MobileTabBarProps {
  /** 阅读器内直接打开设置抽屉；其他页面缺省跳转 `/?settings=open`。 */
  onOpenSettings?: () => void;
}

/**
 * 移动端底部 tab bar（<768px 显示，桌面端由 md:hidden 隐藏）：
 * 阅读 / 审批台（带待批数徽章）/ 热点 / 设置。触控目标 ≥44px。
 */
export default function MobileTabBar({ onOpenSettings }: MobileTabBarProps) {
  const pathname = usePathname();
  const queueSize = useGovernanceQueueSize();

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

  const settingsItem = onOpenSettings ? (
    <button
      type="button"
      data-testid="mobile-tab-settings"
      aria-label="设置"
      onClick={onOpenSettings}
      className={tabClass(false)}
    >
      <Settings aria-hidden="true" className="h-5 w-5" />
      <span>设置</span>
    </button>
  ) : (
    <Link
      href="/?settings=open"
      data-testid="mobile-tab-settings"
      aria-label="设置"
      className={tabClass(false)}
    >
      <Settings aria-hidden="true" className="h-5 w-5" />
      <span>设置</span>
    </Link>
  );

  return (
    <nav
      data-testid="mobile-tab-bar"
      aria-label="主导航"
      className="fixed inset-x-3 bottom-3 z-40 md:hidden"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <div className="glass-surface-strong flex h-14 items-stretch overflow-hidden rounded-[24px]">
        <Link href="/" aria-label="阅读" aria-current={pathname === '/' ? 'page' : undefined} className={tabClass(pathname === '/')}>
          {indicator(pathname === '/')}
          <BookOpen aria-hidden="true" className="h-5 w-5" />
          <span>阅读</span>
        </Link>
        <Link
          href="/governance"
          aria-label="审批台"
          aria-current={pathname === '/governance' ? 'page' : undefined}
          className={tabClass(pathname === '/governance')}
        >
          {indicator(pathname === '/governance')}
          <span className="relative">
            <Stamp aria-hidden="true" className="h-5 w-5" />
            {queueSize > 0 ? (
              <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-semibold tabular-nums text-warning-foreground">
                {queueSize > 99 ? '99+' : queueSize}
              </span>
            ) : null}
          </span>
          <span>审批台</span>
        </Link>
        <Link
          href="/trending"
          aria-label="热点"
          aria-current={pathname === '/trending' ? 'page' : undefined}
          className={tabClass(pathname === '/trending')}
        >
          {indicator(pathname === '/trending')}
          <Flame aria-hidden="true" className="h-5 w-5" />
          <span>热点</span>
        </Link>
        {settingsItem}
      </div>
    </nav>
  );
}
