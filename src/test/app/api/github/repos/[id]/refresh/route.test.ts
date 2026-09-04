import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const getGithubSubscriptionRowMock = vi.fn();
const getFeedByIdMock = vi.fn();
const enqueueWithResultMock = vi.fn();
const getQueueSendOptionsMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/github/repositories/githubSubscriptionsRepo', () => ({
  getGithubSubscriptionRow: (...args: unknown[]) => getGithubSubscriptionRowMock(...args),
}));

vi.mock('@/server/domains/feeds/repositories/feedsRepo', () => ({
  getFeedById: (...args: unknown[]) => getFeedByIdMock(...args),
}));

vi.mock('@/server/infra/queue/queue', () => ({
  enqueueWithResult: (...args: unknown[]) => enqueueWithResultMock(...args),
}));

vi.mock('@/server/infra/queue/contracts', () => ({
  getQueueSendOptions: (...args: unknown[]) => getQueueSendOptionsMock(...args),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

describe('/api/github/repos/[id]/refresh', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    getGithubSubscriptionRowMock.mockResolvedValue({
      feedId: '42',
      userId: '1',
      owner: 'torvalds',
      repo: 'linux',
    });
    getFeedByIdMock.mockResolvedValue({ id: '42', enabled: true });
    enqueueWithResultMock.mockResolvedValue({ status: 'enqueued', jobId: 'job-1' });
    getQueueSendOptionsMock.mockReturnValue({ singletonKey: '1:42', singletonSeconds: 300 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST enqueues a single-repo sync', async () => {
    const mod = await import('../../../../../../../app/api/github/repos/[id]/refresh/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos/42/refresh', { method: 'POST' }),
      { params: Promise.resolve({ id: '42' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toEqual({ enqueued: true, feedId: '42' });
    expect(enqueueWithResultMock).toHaveBeenCalledWith(
      'github.fetch_repo',
      { userId: '1', feedId: '42', force: true },
      { singletonKey: '1:42', singletonSeconds: 300 },
    );
  });

  it('POST reports already_enqueued when the job is deduplicated', async () => {
    enqueueWithResultMock.mockResolvedValue({ status: 'throttled_or_duplicate' });

    const mod = await import('../../../../../../../app/api/github/repos/[id]/refresh/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos/42/refresh', { method: 'POST' }),
      { params: Promise.resolve({ id: '42' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual({ enqueued: false, feedId: '42', reason: 'already_enqueued' });
  });

  it('POST returns 404 when subscription does not exist', async () => {
    getGithubSubscriptionRowMock.mockResolvedValue(null);

    const mod = await import('../../../../../../../app/api/github/repos/[id]/refresh/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos/999/refresh', { method: 'POST' }),
      { params: Promise.resolve({ id: '999' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.code).toBe('not_found');
    expect(enqueueWithResultMock).not.toHaveBeenCalled();
  });

  it('POST returns 400 when the feed is disabled', async () => {
    getFeedByIdMock.mockResolvedValue({ id: '42', enabled: false });

    const mod = await import('../../../../../../../app/api/github/repos/[id]/refresh/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos/42/refresh', { method: 'POST' }),
      { params: Promise.resolve({ id: '42' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.fields.id).toBe('该订阅已停用');
    expect(enqueueWithResultMock).not.toHaveBeenCalled();
  });

  it('POST returns 400 when id is missing', async () => {
    const mod = await import('../../../../../../../app/api/github/repos/[id]/refresh/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos/refresh', { method: 'POST' }),
      { params: Promise.resolve({ id: '' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.fields.id).toBeDefined();
  });
});
