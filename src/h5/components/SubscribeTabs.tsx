'use client';

import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** lucide 图标的宽松类型（只用到 className）。 */
export type NavIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;

export interface SubscribeTabItem<Key extends string> {
  key: Key;
  label: string;
  Icon: NavIcon;
}

/** 二级筛选 pill（数据形态：渲染由 SubscribeTabs 统一负责，保证所有来源同几何）。 */
export interface SubscribePill {
  key: string;
  label: string;
  count?: number;
  active?: boolean;
}

/** 视图 → 统一导航的数据上报契约（热点控制台 / RSS 流等各视图都报这个结构）。 */
export interface SubscribeNavState {
  /** 二级筛选 pills（全量可选项，active 标当前） */
  pills?: SubscribePill[];
  /** pill 点击回调（key = pill.key） */
  onPill?: (key: string) => void;
  /** 二级行尾统计（日期·条数…） */
  stats?: string;
  /** 是否支持手动同步（热点新闻） */
  canSync?: boolean;
  syncing?: boolean;
  onSync?: () => void;
  /** 手动刷新 */
  onRefresh?: () => void;
}

export interface SubscribeTabsProps<Key extends string> {
  /** 一级：订阅来源（subscribe_sources 表下发，可配置新增） */
  tabs: Array<SubscribeTabItem<Key>>;
  active: Key;
  onChange: (key: Key) => void;
  /** 二级：当前来源的筛选 pills（数据形态）。undefined/空也占位，切 tab 高度恒定。 */
  pills?: SubscribePill[];
  onPill?: (key: string) => void;
  /** 二级行尾统计（日期·条数…） */
  stats?: string;
  /** 一级行尾：订阅管理加号（父级提供，点击打开勾选面板） */
  plus?: ReactNode;
  /** 一级行尾：手动同步（仅热点新闻有） */
  sync?: { syncing: boolean; onSync: () => void } | null;
  /** 一级行尾：手动刷新（所有来源） */
  onRefresh?: (() => void) | null;
  className?: string;
}

/**
 * 订阅页统一导航（唯一渲染点）：
 *   一级 h-9 行：来源 tab（subscribe_sources 配置下发）+ 加号/同步/刷新；
 *   二级 h-9 行：筛选 pills（数据驱动）+ 行尾统计。空行也占位，切 tab 宽高恒定。
 * 所有 pill 统一 h-8 / shrink-0 / 不换行，横排滚动——一级二级同一套渲染代码。
 */
export default function SubscribeTabs<Key extends string>({
  tabs,
  active,
  onChange,
  pills,
  onPill,
  stats,
  plus,
  sync,
  onRefresh,
  className,
}: SubscribeTabsProps<Key>) {
  const pillClass = (isActive: boolean) =>
    cn(
      'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      isActive
        ? 'border-primary/40 bg-primary/10 text-primary'
        : 'border-border text-muted-foreground hover:text-foreground',
    );
  const roundBtn =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  return (
    <div className={cn('mb-2 shrink-0', className)}>
      {/* 一级：来源 tab + 行尾动作 */}
      <div className="flex h-9 items-center gap-1.5">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => onChange(key)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active === key
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {plus}
          {sync ? (
            <button
              type="button"
              onClick={sync.onSync}
              disabled={sync.syncing}
              aria-label="立即同步"
              title="立即同步"
              className={cn(roundBtn, 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50')}
            >
              <RefreshCwSVG spinning={sync.syncing} />
            </button>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="刷新"
              className={cn(roundBtn, 'border-border text-muted-foreground hover:text-primary')}
            >
              <RefreshCwSVG spinning={false} />
            </button>
          ) : null}
        </div>
      </div>
      {/* 二级：筛选 pills + 行尾统计（恒占位，空也保持高度） */}
      <div className="mt-1.5 flex h-9 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(pills ?? []).map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={!!p.active}
              onClick={() => onPill?.(p.key)}
              className={pillClass(!!p.active)}
            >
              {p.label}
              {typeof p.count === 'number' ? (
                <span className="font-mono text-[10px] tabular-nums opacity-60">{p.count}</span>
              ) : null}
            </button>
          ))}
        </div>
        {stats ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{stats}</span>
        ) : null}
      </div>
    </div>
  );
}

function RefreshCwSVG({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('h-4 w-4', spinning && 'animate-spin')}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
