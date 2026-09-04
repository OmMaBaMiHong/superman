'use client';

import type { ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** 底部固定操作区。 */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 右侧详情抽屉。
 *
 * 直接复用 `ui/sheet`（Radix Dialog），focus trap、ESC 关闭、遮罩均由其提供，
 * 不另造一套 portal 实现。玻璃质感来自 `.glass-surface-strong`（导航/固定区用 strong）；
 * 需用 `bg-transparent` 抵消 Sheet 默认的 `bg-background` 实底，让玻璃层透出。
 *
 * 布局为「头部固定 + 内容滚动 + 底部固定」，头部留出右上角关闭按钮的位置（pr-12）。
 */
export default function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: DetailDrawerProps) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className={cn(
          'glass-surface-strong flex flex-col gap-0 rounded-l-2xl rounded-r-none bg-transparent p-0 dark:bg-transparent sm:max-w-md',
          className,
        )}
        side="right"
      >
        <SheetHeader className="shrink-0 border-b border-border/60 px-6 pb-4 pr-12 pt-6 text-left">
          <SheetTitle>{title}</SheetTitle>
          {/* Radix 要求 Dialog 必须有 Description，视觉上不需要时降级为 sr-only。 */}
          <SheetDescription className={cn(!description && 'sr-only')}>
            {description ?? title}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {footer ? (
          <SheetFooter className="shrink-0 border-t border-border/60 px-6 py-4">
            {footer}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
