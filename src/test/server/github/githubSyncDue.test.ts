import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

vi.mock('@/server/domains/github/repositories/githubSubscriptionsRepo', () => ({
  listDueSubscriptions: vi.fn(),
}));

vi.mock('@/server/infra/queue/queue', () => ({
  enqueueWithResult: vi.fn(),
}));

import { runGithubSyncDue } from '@/worker/githubSyncDue';
import { listDueSubscriptions } from '@/server/domains/github/repositories/githubSubscriptionsRepo';
import { enqueueWithResult } from '@/server/infra/queue/queue';
import { JOB_GITHUB_FETCH_REPO } from '@/server/infra/queue/jobs';

const listDueMock = vi.mocked(listDueSubscriptions);
const enqueueMock = vi.mocked(enqueueWithResult);

const POOL = {} as Pool;
const NOW = new Date('2025-06-01T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runGithubSyncDue', () => {
  it('无到期订阅时不投递任何任务', async () => {
    listDueMock.mockResolvedValue([]);

    const result = await runGithubSyncDue({ pool: POOL, now: NOW, userId: 'user-1' });

    expect(result).toEqual({ enqueued: 0 });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('为每个到期订阅投递单仓库同步任务', async () => {
    listDueMock.mockResolvedValue([
      { feedId: 'feed-1', userId: 'user-1' },
      { feedId: 'feed-2', userId: 'user-1' },
    ]);
    enqueueMock.mockResolvedValue({ status: 'enqueued', jobId: 'job-1' });

    const result = await runGithubSyncDue({ pool: POOL, now: NOW, userId: 'user-1' });

    expect(result).toEqual({ enqueued: 2 });
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(enqueueMock).toHaveBeenNthCalledWith(
      1,
      JOB_GITHUB_FETCH_REPO,
      { userId: 'user-1', feedId: 'feed-1' },
      expect.objectContaining({ singletonKey: expect.stringContaining('feed-1') }),
    );
  });

  it('被 singletonKey 去重的任务不计入 enqueued', async () => {
    listDueMock.mockResolvedValue([
      { feedId: 'feed-1', userId: 'user-1' },
      { feedId: 'feed-2', userId: 'user-1' },
    ]);
    enqueueMock
      .mockResolvedValueOnce({ status: 'enqueued', jobId: 'job-1' })
      .mockResolvedValueOnce({ status: 'throttled_or_duplicate' });

    const result = await runGithubSyncDue({ pool: POOL, now: NOW, userId: 'user-1' });

    expect(result).toEqual({ enqueued: 1 });
  });

  it('把当前时间与用户范围透传给仓储查询', async () => {
    listDueMock.mockResolvedValue([]);

    await runGithubSyncDue({ pool: POOL, now: NOW, userId: 'user-9' });

    expect(listDueMock).toHaveBeenCalledWith(POOL, NOW, 'user-9');
  });
});
