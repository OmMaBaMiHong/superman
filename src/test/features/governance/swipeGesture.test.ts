import { describe, expect, it } from 'vitest';
import {
  clampDragOffset,
  decideSwipeOutcome,
  SWIPE_MAX_DRAG_PX,
  SWIPE_THRESHOLD_PX,
} from '../../../features/governance/lib/swipeGesture';

describe('decideSwipeOutcome（审批卡片手势阈值判定）', () => {
  const WIDTH = 360; // 375px 视口下卡片宽度量级

  it('右滑超过阈值 → 准奏', () => {
    expect(decideSwipeOutcome({ dx: SWIPE_THRESHOLD_PX, dy: 0, cardWidth: WIDTH })).toBe('approve');
    expect(decideSwipeOutcome({ dx: 160, dy: 10, cardWidth: WIDTH })).toBe('approve');
  });

  it('左滑超过阈值 → 驳回', () => {
    expect(decideSwipeOutcome({ dx: -SWIPE_THRESHOLD_PX, dy: 0, cardWidth: WIDTH })).toBe('reject');
    expect(decideSwipeOutcome({ dx: -160, dy: -10, cardWidth: WIDTH })).toBe('reject');
  });

  it('位移不足阈值 → 不触发（回弹）', () => {
    expect(decideSwipeOutcome({ dx: SWIPE_THRESHOLD_PX - 1, dy: 0, cardWidth: WIDTH })).toBeNull();
    expect(decideSwipeOutcome({ dx: -20, dy: 0, cardWidth: WIDTH })).toBeNull();
    expect(decideSwipeOutcome({ dx: 0, dy: 0, cardWidth: WIDTH })).toBeNull();
  });

  it('垂直意图占优 → 视为滚动，不触发动作', () => {
    // |dy| > |dx| × 0.6
    expect(decideSwipeOutcome({ dx: 120, dy: 80, cardWidth: WIDTH })).toBeNull();
    expect(decideSwipeOutcome({ dx: -120, dy: -100, cardWidth: WIDTH })).toBeNull();
    // 边界：|dy| = |dx| × 0.6 仍算横向手势
    expect(decideSwipeOutcome({ dx: 120, dy: 72, cardWidth: WIDTH })).toBe('approve');
  });

  it('窄卡片阈值取宽度 35%（小屏不至于滑不出）', () => {
    const narrow = 200; // 35% = 70px < 96px
    expect(decideSwipeOutcome({ dx: 70, dy: 0, cardWidth: narrow })).toBe('approve');
    expect(decideSwipeOutcome({ dx: 69, dy: 0, cardWidth: narrow })).toBeNull();
  });
});

describe('clampDragOffset（拖拽位移收敛）', () => {
  it('上限内原样跟手', () => {
    expect(clampDragOffset(80)).toBe(80);
    expect(clampDragOffset(-SWIPE_MAX_DRAG_PX)).toBe(-SWIPE_MAX_DRAG_PX);
  });

  it('超过上限后阻尼衰减（1/4 弹性）', () => {
    expect(clampDragOffset(SWIPE_MAX_DRAG_PX + 40)).toBe(SWIPE_MAX_DRAG_PX + 10);
    expect(clampDragOffset(-(SWIPE_MAX_DRAG_PX + 40))).toBe(-(SWIPE_MAX_DRAG_PX + 10));
  });
});
