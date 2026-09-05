/**
 * 审批卡片滑动手势的纯判定逻辑（与组件解耦，便于单测）。
 * 右滑 = 准奏，左滑 = 驳回（打开理由输入），与 J/K/A/R 快捷键平级。
 */

export const SWIPE_THRESHOLD_PX = 96;
/** 位移硬上限：拖拽跟手但不超过该值，避免卡片飞出视口。 */
export const SWIPE_MAX_DRAG_PX = 140;

export type SwipeOutcome = 'approve' | 'reject' | null;

/**
 * 根据抬手时的位移判定手势结果。
 * - 阈值：min(96px, 卡片宽度 35%)，小屏不至于滑不出、窄卡不至于误触；
 * - 垂直意图保护：|dy| > |dx| × 0.6 视为纵向滚动，不触发动作。
 */
export function decideSwipeOutcome(input: {
  dx: number;
  dy: number;
  cardWidth: number;
}): SwipeOutcome {
  const threshold = Math.min(SWIPE_THRESHOLD_PX, input.cardWidth * 0.35);
  if (Math.abs(input.dx) < threshold) return null;
  if (Math.abs(input.dy) > Math.abs(input.dx) * 0.6) return null;
  return input.dx > 0 ? 'approve' : 'reject';
}

/** 拖拽中位移收敛：超过上限后阻尼衰减，跟手但克制。 */
export function clampDragOffset(dx: number): number {
  const sign = Math.sign(dx);
  const abs = Math.abs(dx);
  if (abs <= SWIPE_MAX_DRAG_PX) return dx;
  return sign * (SWIPE_MAX_DRAG_PX + (abs - SWIPE_MAX_DRAG_PX) * 0.25);
}
