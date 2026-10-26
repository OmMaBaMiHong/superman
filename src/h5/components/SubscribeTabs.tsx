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

export interface SubscribeTabsProps<Key extends string> {
  /** 一级：订阅来源（subscribe_sources 表下发，可配置新增） */
  tabs: Array<SubscribeTabItem<Key>>;
  active: Key;
  onChange: (key: Key) => void;
  /** 二级：当前来源的筛选 pills（RSS 分类 / 热点平台…）。空也占位，保证切 tab 高度恒定。 */
  secondary?: ReactNode;
  /** 一级行尾动作（刷新 / 同步…） */
  actions?: ReactNode;
  /** 二级行尾统计（日期·条数…） */
  stats?: ReactNode;
  className?: string;
}

/**
 * 订阅页统一导航（唯一渲染点，一/二级共用同一套几何）：
 *   一级 h-9 行：来源 tab（配置下发）+ 行尾动作；
 *   二级 h-9 行：筛选 pills + 行尾统计。空行也占位，切换 tab 宽高不跳。
 * 所有 pill 统一 h-8。视图通过 props 上报二级内容，不各自造导航。
 */
export default function SubscribeTabs<Key extends string>({
  tabs,
  active,
  onChange,
  secondary,
  actions,
  stats,
  className,
}: SubscribeTabsProps<Key>) {
  return (
    <div className={cn('mb-2 shrink-0', className)}>
      <div className="flex h-9 items-center gap-1.5">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => onChange(key)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
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
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      <div className="mt-1.5 flex h-9 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {secondary}
        </div>
        {stats ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{stats}</span>
        ) : null}
      </div>
    </div>
  );
}
