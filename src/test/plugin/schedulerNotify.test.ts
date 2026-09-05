import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifyMock = vi.fn(async () => ({ id: 'n1' }));
const notifyOnceMock = vi.fn(async () => ({ id: 'n2' }));
const fetchMock = vi.fn();
const governanceStatsMock = vi.fn(async () => ({ queueSize: 12, todayPending: 0, todayArchived: 0, todayFetchSucceeded: 0, todayFetchFailed: 0 }));

vi.mock('@/core/notify/service', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
  notifyOncePerWindow: (...args: unknown[]) => notifyOnceMock(...args),
}));

vi.mock('@/worker/index', () => ({
  fetchAndIngestFeed: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock('@/core/governance/repository', () => ({
  getGovernanceStats: (...args: unknown[]) => governanceStatsMock(...args),
}));

vi.mock('@/core/auth/usersRepo', () => ({
  listUsers: vi.fn(async () => [{ id: '1', status: 'active' }]),
}));

vi.mock('@/server/domains/feeds/repositories/feedsRepo', () => ({
  listEnabledFeedsForFetch: vi.fn(async () => [
    { id: 'f1', userId: '1', title: '示例源', fetchIntervalMinutes: 1, lastFetchedAt: null },
  ]),
}));

vi.mock('@/worker/refreshAll', () => ({
  selectFeedsForRefreshAll: vi.fn((feeds: unknown[]) => feeds),
}));

import { fetchDueFeedsOnce } from '@/plugin/host/jobs/scheduler';
import { startPluginScheduler } from '@/plugin/host/jobs/scheduler';

const fakePool = { query: vi.fn(async () => ({ rows: [] })) };

describe('plugin/host/scheduler · P2a 事件挂钩', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetch_failed：抓取失败写消息中心（带源名与错误摘要，link=/reader）', async () => {
    fetchMock.mockResolvedValue({ inserted: 0, errorMessage: 'fetch failed: timeout 15s' });

    await fetchDueFeedsOnce(fakePool as never);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'fetch_failed',
        link: '/reader',
        userId: '1',
      }),
    );
    const [, payload] = notifyMock.mock.calls[0] as unknown as [unknown, { title: string; body: string }];
    expect(payload.title).toContain('示例源');
    expect(payload.body).toContain('timeout');
  });

  it('抓取成功不写消息', async () => {
    fetchMock.mockResolvedValue({ inserted: 3, errorMessage: null });

    await fetchDueFeedsOnce(fakePool as never);

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('pending_backlog：待批 >10 时调用 24h 去重通知（link=/studio?tab=queue）', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = startPluginScheduler(fakePool as never, { schedulerEnabled: true, feedRefreshIntervalMs: 1000 }, {
        log: () => {},
        warn: () => {},
      });
      fetchMock.mockResolvedValue({ inserted: 0, errorMessage: null });
      await vi.advanceTimersByTimeAsync(1100);

      expect(notifyOnceMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'pending_backlog',
          link: '/studio?tab=queue',
          windowSeconds: 86400,
        }),
      );
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('待批 ≤10 不发积压提醒', async () => {
    governanceStatsMock.mockResolvedValue({ queueSize: 3, todayPending: 0, todayArchived: 0, todayFetchSucceeded: 0, todayFetchFailed: 0 });
    vi.useFakeTimers();
    try {
      const scheduler = startPluginScheduler(fakePool as never, { schedulerEnabled: true, feedRefreshIntervalMs: 1000 }, {
        log: () => {},
        warn: () => {},
      });
      fetchMock.mockResolvedValue({ inserted: 0, errorMessage: null });
      await vi.advanceTimersByTimeAsync(1100);

      expect(notifyOnceMock).not.toHaveBeenCalled();
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
