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

/**
 * 视图 → 统一导航的数据上报契约（热点控制台 / RSS 流等各视图都报这个结构）。
 * pillGroups 支持多层级联：每组一行 pills，组内单选由视图自己维护。
 */
export interface SubscribeNavState {
  /** 每层一组 pills；组内 key 点击经 onPill 回给视图 */
  pillGroups?: Array<SubscribePill[]>;
  onPill?: (groupIndex: number, key: string) => void;
  /** 最后一组的行尾统计（日期·条数…） */
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
  /** 二级：级联筛选 pills（数据形态，每组一行）。undefined/空也占位，切 tab 高度恒定。 */
  pillGroups?: Array<SubscribePill[]>;
  onPill?: (groupIndex: number, key: string) => void;
  /** 最后一组的行尾统计（日期·条数…） */
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
 *   二级每组 h-9 行：级联筛选 pills + 末组行尾统计。空组也占位，切 tab 宽高恒定。
 * 所有 pill 统一 h-8 / shrink-0 / 不换行，横排滚动——一级二级同一套渲染代码，
 * 数据来源（热点/GitHub/DSH/RSS）只决定 pills 内容，不决定渲染。
 */
export default function SubscribeTabs<Key extends string>({
  tabs,
  active,
  onChange,
  pillGroups,
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
  const groups = pillGroups ?? [];

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
              <RefreshCwIcon spinning={sync.syncing} />
            </button>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="刷新"
              className={cn(roundBtn, 'border-border text-muted-foreground hover:text-primary')}
            >
              <RefreshCwIcon spinning={false} />
            </button>
          ) : null}
        </div>
      </div>
      {/* 二级：每组一行级联 pills + 末组行尾统计（恒占位） */}
      <div className="mt-1.5 space-y-1.5">
        {(groups.length > 0 ? groups : [[]]).map((group, groupIndex) => (
          <div key={groupIndex} className="flex h-9 items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {group.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={!!p.active}
                  onClick={() => onPill?.(groupIndex, p.key)}
                  className={pillClass(!!p.active)}
                >
                  {p.label}
                  {typeof p.count === 'number' ? (
                    <span className="font-mono text-[10px] tabular-nums opacity-60">{p.count}</span>
                  ) : null}
                </button>
              ))}
            </div>
            {groupIndex === groups.length - 1 && stats ? (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{stats}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function RefreshCwIcon({ spinning }: { spinning: boolean }) {
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
