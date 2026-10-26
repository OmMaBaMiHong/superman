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
  /** 一级：订阅来源（热点新闻 / RSS 订阅 / GitHub / DSH 插件…） */
  tabs: Array<SubscribeTabItem<Key>>;
  active: Key;
  onChange: (key: Key) => void;
  /** 二级：当前 tab 的分类/筛选行，紧贴一级下方（RSS 分类 chips 等） */
  secondary?: ReactNode;
  /** 行尾动作（手动刷新等） */
  actions?: ReactNode;
  className?: string;
}

/**
 * 订阅页统一双层导航：
 * 一行一级来源 tab，二级分类紧贴其下（mt-1.5，同款 pill 形态），
 * 行尾放动作按钮。层级间隔固定，避免两套导航各自为政。
 */
export default function SubscribeTabs<Key extends string>({
  tabs,
  active,
  onChange,
  secondary,
  actions,
  className,
}: SubscribeTabsProps<Key>) {
  return (
    <div className={cn('mb-2', className)}>
      <div className="flex items-center gap-1.5">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => onChange(key)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
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
        {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
      </div>
      {secondary ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{secondary}</div>
      ) : null}
    </div>
  );
}
