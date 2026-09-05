'use client';

import { useRef, useState, type TouchEvent } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { clampDragOffset, decideSwipeOutcome } from '../lib/swipeGesture';

interface UseCardSwipeInput {
  /** 手势进行中（其他动作 pending / 退出动画中）时禁用。 */
  disabled: boolean;
  onApprove: () => void;
  /** 左滑驳回：回弹后打开理由输入（与 R 快捷键同语义）。 */
  onOpenRejectReason: () => void;
}

interface UseCardSwipeResult {
  /** 当前拖拽位移（px），0 = 静止/回弹。 */
  dragX: number;
  /** 是否处于「已判定横向滑动」状态（用于抑制点击选中）。 */
  swiping: boolean;
  /** 滑动刚结束时短暂返回 true：抑制 touchend 后紧随的 click 误触发卡片选中。 */
  shouldSuppressClick: () => boolean;
  swipeHandlers: {
    onTouchStart: (event: TouchEvent<HTMLElement>) => void;
    onTouchMove: (event: TouchEvent<HTMLElement>) => void;
    onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
    onTouchCancel: () => void;
  };
}

/**
 * 审批卡片触控手势：touch 事件手写实现（不装库）。
 * - 横向位移跟手（带阻尼上限），松手过阈值触发动作，否则 0.42s 回弹；
 * - 垂直意图视为滚动，不拦截；
 * - prefers-reduced-motion：整体降级为按钮-only，手势不生效。
 */
export function useCardSwipe({
  disabled,
  onApprove,
  onOpenRejectReason,
}: UseCardSwipeInput): UseCardSwipeResult {
  const reducedMotion = usePrefersReducedMotion();
  const [dragX, setDragX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startRef = useRef<{ x: number; y: number; locked: 'horizontal' | 'vertical' | null } | null>(null);

  const enabled = !disabled && !reducedMotion;
  const suppressClickUntilRef = useRef(0);

  const markSuppressClick = () => {
    suppressClickUntilRef.current = Date.now() + 400;
  };

  const shouldSuppressClick = () => Date.now() < suppressClickUntilRef.current;

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (!enabled) return;
    const touch = event.touches[0];
    if (!touch) return;
    startRef.current = { x: touch.clientX, y: touch.clientY, locked: null };
  };

  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!enabled || !start) return;
    const touch = event.touches[0];
    if (!touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // 意图判定：先积累 8px 再锁方向；纵向锁定后不干预页面滚动
    if (start.locked === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      start.locked = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
      if (start.locked === 'vertical') return;
      setSwiping(true);
    }
    if (start.locked !== 'horizontal') return;

    markSuppressClick();
    setDragX(clampDragOffset(dx));
  };

  const settle = (event: TouchEvent<HTMLElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!enabled || !start || start.locked !== 'horizontal') {
      setSwiping(false);
      return;
    }

    const touch = event.changedTouches[0];
    const dx = touch ? touch.clientX - start.x : 0;
    const dy = touch ? touch.clientY - start.y : 0;
    const card = event.currentTarget;
    const outcome = decideSwipeOutcome({ dx, dy, cardWidth: card.offsetWidth || 360 });

    // 回弹（CSS transition 接管 transform → 0）
    setDragX(0);
    setSwiping(false);

    if (outcome === 'approve') {
      onApprove();
    } else if (outcome === 'reject') {
      onOpenRejectReason();
    }
  };

  const onTouchCancel = () => {
    startRef.current = null;
    setDragX(0);
    setSwiping(false);
  };

  return {
    dragX,
    swiping,
    shouldSuppressClick,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: settle,
      onTouchCancel,
    },
  };
}
