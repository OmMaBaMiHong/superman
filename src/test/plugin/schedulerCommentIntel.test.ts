import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommentIntelTickMock = vi.fn(async () => ({
  due: 0, synced: 0, failed: 0, analyzed: 0, promoted: 0,
}));

vi.mock('@/core/comment-intel/service', () => ({
  runCommentIntelTick: (...args: unknown[]) => runCommentIntelTickMock(...args),
}));

vi.mock('@/core/auth/usersRepo', () => ({
  listUsers: vi.fn(async () => [
    { id: '1', status: 'active' },
    { id: '2', status: 'disabled' },
  ]),
}));

import { startPluginScheduler } from '@/plugin/host/jobs/scheduler';

const fakePool = { query: vi.fn(async () => ({ rows: [] })) };
const logger = { log: () => {}, warn: () => {} };

describe('plugin/host/scheduler · commentIntel.tick（P3a-7）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按间隔对每个 active 用户跑一轮评论反哺（跳过非 active）', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = startPluginScheduler(
        fakePool as never,
        { schedulerEnabled: true, commentIntelIntervalMs: 100 },
        logger,
      );
      await vi.advanceTimersByTimeAsync(150);

      expect(runCommentIntelTickMock).toHaveBeenCalledTimes(1);
      expect(runCommentIntelTickMock).toHaveBeenCalledWith(fakePool, { userId: '1' });
      scheduler.stop();

      await vi.advanceTimersByTimeAsync(300);
      expect(runCommentIntelTickMock).toHaveBeenCalledTimes(1); // stop 后不再跑
    } finally {
      vi.useRealTimers();
    }
  });

  it('默认关闭：schedulerEnabled 未开时不调度', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = startPluginScheduler(fakePool as never, {}, logger);
      await vi.advanceTimersByTimeAsync(1000);
      expect(runCommentIntelTickMock).not.toHaveBeenCalled();
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
