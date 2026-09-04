import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubApiError } from '@/server/integrations/github/githubErrors';

function makeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '42',
    feedId: '42',
    owner: 'torvalds',
    repo: 'linux',
    fullName: 'torvalds/linux',
    title: 'torvalds/linux',
    htmlUrl: 'https://github.com/torvalds/linux',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1024025',
    contentTypes: ['release'],
    includePrerelease: false,
    enabled: true,
    fetchIntervalMinutes: 60,
    categoryId: null,
    unreadCount: 0,
    status: 'idle',
    lastSyncedAt: null,
    nextSyncAt: null,
    rateLimitedUntil: null,
    lastError: null,
    lastErrorCode: null,
    ...overrides,
  };
}

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const listGithubSubscriptionsMock = vi.fn();
const createGithubSubscriptionServiceMock = vi.fn();
const updateGithubSubscriptionServiceMock = vi.fn();
const deleteGithubSubscriptionServiceMock = vi.fn();
const getGithubTokenMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/github/repositories/githubSubscriptionsRepo', () => ({
  listGithubSubscriptions: (...args: unknown[]) => listGithubSubscriptionsMock(...args),
}));

vi.mock('@/server/domains/github/services/githubSubscriptionLifecycleService', () => ({
  createGithubSubscriptionService: (...args: unknown[]) => createGithubSubscriptionServiceMock(...args),
  updateGithubSubscriptionService: (...args: unknown[]) => updateGithubSubscriptionServiceMock(...args),
  deleteGithubSubscriptionService: (...args: unknown[]) => deleteGithubSubscriptionServiceMock(...args),
}));

vi.mock('@/server/domains/github/services/githubTokenService', () => ({
  getGithubToken: (...args: unknown[]) => getGithubTokenMock(...args),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

describe('/api/github/repos', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    listGithubSubscriptionsMock.mockResolvedValue([]);
    createGithubSubscriptionServiceMock.mockResolvedValue(makeSubscription());
    getGithubTokenMock.mockResolvedValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET returns the user subscription list', async () => {
    listGithubSubscriptionsMock.mockResolvedValue([
      makeSubscription({ id: '1', repo: 'linux' }),
      makeSubscription({ id: '2', repo: 'react' }),
    ]);

    const mod = await import('../../../../../app/api/github/repos/route');
    const response = await mod.GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(listGithubSubscriptionsMock).toHaveBeenCalledTimes(1);
  });

  it('GET returns 401 when session is missing', async () => {
    requireApiSessionMock.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) });

    const mod = await import('../../../../../app/api/github/repos/route');
    const response = await mod.GET();

    expect(response.status).toBe(401);
  });

  it('POST creates a subscription from a repoInput', async () => {
    getGithubTokenMock.mockResolvedValue('');
    createGithubSubscriptionServiceMock.mockResolvedValue(makeSubscription({ repo: 'linux' }));

    const mod = await import('../../../../../app/api/github/repos/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: 'torvalds/linux' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.repo).toBe('linux');
    expect(createGithubSubscriptionServiceMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ repoInput: 'torvalds/linux', userId: '1' }),
    );
  });

  it('POST rejects non-release content types with unsupported_in_mvp', async () => {
    const mod = await import('../../../../../app/api/github/repos/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: 'torvalds/linux', contentTypes: ['issue'] }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.contentTypes).toBe('unsupported_in_mvp');
    expect(createGithubSubscriptionServiceMock).not.toHaveBeenCalled();
  });

  it('POST rejects when neither repoInput nor owner/repo provided', async () => {
    const mod = await import('../../../../../app/api/github/repos/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.repoInput).toBeDefined();
    expect(createGithubSubscriptionServiceMock).not.toHaveBeenCalled();
  });

  it('POST maps duplicate (23505) to a conflict error', async () => {
    createGithubSubscriptionServiceMock.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );

    const mod = await import('../../../../../app/api/github/repos/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: 'torvalds/linux' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe('conflict');
    expect(json.error.fields.repoInput).toBe('duplicate');
  });

  it('POST maps GitHub not_found to a validation error on repoInput', async () => {
    createGithubSubscriptionServiceMock.mockRejectedValue(new GithubApiError('not_found'));

    const mod = await import('../../../../../app/api/github/repos/route');
    const response = await mod.POST(
      new Request('http://localhost/api/github/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: 'ghost/nope' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.repoInput).toBe('not_found');
  });
});
