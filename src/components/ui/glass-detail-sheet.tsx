'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const ENTER_DELAY_MS = 20;
const EXIT_DURATION_MS = 350;
const CLOSE_DRAG_THRESHOLD_PX = 120;

interface GlassDetailSheetProps {
  open: boolean;
  onClose: () => void;
  /** 无障碍标题（sr-only 或可见标题由 children 自带）。 */
  ariaLabel: string;
  children: ReactNode;
}

/**
 * 液态玻璃详情壳层（审批台/热点共用）：
 * - 移动端：底部全屏 sheet，从底部滑上（0.35s cubic-bezier(0.32,0.72,0,1)），
 *   顶部拖动柄，下滑超过 120px 松手关闭；
 * - 桌面端：居中玻璃 modal；
 * - Esc / 点遮罩关闭；reduced-motion 由全局 CSS 降级。
 */
export default function GlassDetailSheet({
  open,
  onClose,
  ariaLabel,
  children,
}: GlassDetailSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef<number | null>(null);

  // 挂载 → 下一帧进入（触发 CSS 转场）；关闭 → 退出动画后卸载。
  // setState 全部走异步调度（react-hooks/set-state-in-effect 合规）。
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(timer);
    }
    const exitTimer = window.setTimeout(() => {
      setMounted(false);
      setDragY(0);
    }, EXIT_DURATION_MS);
    const hideTimer = window.setTimeout(() => setShown(false), 0);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return undefined;
    const timer = window.setTimeout(() => setShown(true), ENTER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Esc 关闭 + 打开期间锁定背景滚动
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const onHandleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    dragStartRef.current = event.touches[0]?.clientY ?? null;
  };

  const onHandleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const touch = event.touches[0];
    if (start === null || !touch) return;
    setDragY(Math.max(0, touch.clientY - start));
  };

  const onHandleTouchEnd = () => {
    const offset = dragY;
    dragStartRef.current = null;
    setDragY(0);
    if (offset > CLOSE_DRAG_THRESHOLD_PX) onClose();
  };

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {/* 遮罩 */}
      <div
        data-testid="glass-sheet-overlay"
        className="absolute inset-0 bg-overlay transition-opacity duration-300"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={onClose}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center md:p-8">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          data-testid="glass-detail-sheet"
          className={cn(
            'glass-sheet glass-surface-strong pointer-events-auto flex flex-col overflow-hidden',
            'max-h-[88vh] rounded-t-[24px] border-b-0',
            'md:max-h-[85vh] md:w-full md:max-w-2xl md:rounded-[24px] md:border-b',
          )}
          style={{
            transform:
              dragY > 0
                ? `translateY(${dragY}px)`
                : shown
                  ? 'translateY(0) scale(1)'
                  : undefined,
            opacity: shown ? 1 : 0,
            ...(dragY === 0 && !shown
              ? { transform: 'translateY(48px) scale(0.98)' }
              : null),
          }}
        >
          {/* 移动端拖动柄（下滑关闭）；桌面端隐藏 */}
          <div
            data-testid="glass-sheet-handle"
            className="flex shrink-0 cursor-grab items-center justify-center pb-1 pt-2.5 active:cursor-grabbing md:hidden"
            style={{ touchAction: 'none' }}
            onTouchStart={onHandleTouchStart}
            onTouchMove={onHandleTouchMove}
            onTouchEnd={onHandleTouchEnd}
            onTouchCancel={onHandleTouchEnd}
          >
            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/35" />
          </div>

          {/* 桌面端关闭按钮 */}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="absolute right-3 top-3 z-10 hidden h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:flex md:h-9 md:w-9"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
