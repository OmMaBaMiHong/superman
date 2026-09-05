import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_LIMIT,
  DEFAULT_FOCUS_RATIO,
  clampDailyLimit,
  clampFocusRatio,
  selectQuotaItems,
  shouldAutoApprove,
  splitQuota,
} from '@/server/domains/governance/quota';

function item(score: number, tag: string) {
  return { qualityScore: score, tag };
}

describe('governance quota / splitQuota', () => {
  it('默认 daily_limit=3、focusRatio=60 → 聚焦 2 / 常驻 1', () => {
    expect(splitQuota(3, 60)).toEqual({ focusQuota: 2, residentQuota: 1 });
  });

  it('focusRatio 边界：0 全给常驻，100 全给聚焦', () => {
    expect(splitQuota(5, 0)).toEqual({ focusQuota: 0, residentQuota: 5 });
    expect(splitQuota(5, 100)).toEqual({ focusQuota: 5, residentQuota: 0 });
  });

  it('clamp：非法值回退默认，超限收敛', () => {
    expect(clampDailyLimit(undefined)).toBe(DEFAULT_DAILY_LIMIT);
    expect(clampDailyLimit(Number.NaN)).toBe(DEFAULT_DAILY_LIMIT);
    expect(clampDailyLimit(0)).toBe(1);
    expect(clampDailyLimit(500)).toBe(100);
    expect(clampFocusRatio(undefined)).toBe(DEFAULT_FOCUS_RATIO);
    expect(clampFocusRatio(-5)).toBe(0);
    expect(clampFocusRatio(120)).toBe(100);
  });
});

describe('governance quota / selectQuotaItems', () => {
  it('各桶按质量分降序截取配额', () => {
    const focus = [item(90, 'f1'), item(70, 'f2'), item(50, 'f3')];
    const resident = [item(80, 'r1'), item(60, 'r2')];
    const selected = selectQuotaItems({
      focusItems: focus,
      residentItems: resident,
      dailyLimit: 3,
      focusRatio: 60, // 聚焦 2 / 常驻 1
    });
    expect(selected.map((s) => s.tag)).toEqual(['f1', 'f2', 'r1']);
  });

  it('聚焦桶没装满时余量回填常驻桶', () => {
    const focus = [item(90, 'f1')];
    const resident = [item(80, 'r1'), item(70, 'r2'), item(60, 'r3')];
    const selected = selectQuotaItems({
      focusItems: focus,
      residentItems: resident,
      dailyLimit: 3,
      focusRatio: 60, // 聚焦桶只有 1 条，剩 2 回填常驻
    });
    expect(selected.map((s) => s.tag).sort()).toEqual(['f1', 'r1', 'r2']);
  });

  it('常驻桶没装满时余量回填聚焦桶', () => {
    const focus = [item(90, 'f1'), item(85, 'f2'), item(80, 'f3')];
    const resident: Array<ReturnType<typeof item>> = [];
    const selected = selectQuotaItems({
      focusItems: focus,
      residentItems: resident,
      dailyLimit: 3,
      focusRatio: 60,
    });
    expect(selected).toHaveLength(3);
  });

  it('总量永不超过 dailyLimit', () => {
    const focus = Array.from({ length: 10 }, (_, i) => item(100 - i, `f${i}`));
    const resident = Array.from({ length: 10 }, (_, i) => item(100 - i, `r${i}`));
    const selected = selectQuotaItems({
      focusItems: focus,
      residentItems: resident,
      dailyLimit: 4,
      focusRatio: 50,
    });
    expect(selected).toHaveLength(4);
  });
});

describe('governance quota / shouldAutoApprove', () => {
  it('阈值为 0 时永不自动准奏', () => {
    expect(shouldAutoApprove(100, 0)).toBe(false);
  });

  it('分数达标才自动准奏（含恰好等于阈值）', () => {
    expect(shouldAutoApprove(80, 80)).toBe(true);
    expect(shouldAutoApprove(79, 80)).toBe(false);
    expect(shouldAutoApprove(95, 80)).toBe(true);
  });
});
