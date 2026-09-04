import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '42',
    feedId: '42',
    owner: 'torvalds',
    repo: 'linux',
    fullName: 'torvalds/linux',
    title: 'torvalds/linux',
    status: 'idle',
    enabled: true,
    ...overrides,
  };
}

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const updateGithubSubscriptionServiceMock = vi.fn();
const deleteGithubSubscriptionServiceMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/github/services/githubSubscriptionLifecycleService', () => ({
  createGithubSubscriptionService: vi.fn(),
  updateGithubSubscriptionService: (...args: unknown[]) => updateGithubSubscriptionServiceMock(...args),
  deleteGithubSubscriptionService: (...args: unknown[]) => deleteGithubSubscriptionServiceMock(...args),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

describe('/api/github/repos/[id]', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    updateGithubSubscriptionServiceMock.mockImplementation((_pool: unknown, input: Record<string, unknown>) =>
      Promise.resolve(
        makeSubscription({
          enabled: input.enabled,
          title: input.title,
          contentTypes: input.contentTypes,
          includePrerelease: input.includePrerelease,
        }),
      ),
    );
    deleteGithubSubscriptionServiceMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PATCH updates a subscription', async () => {
    const mod = await import('../../../../../../app/api/github/repos/[id]/route');
    const response = await mod.PATCH(
      new Request('http://localhost/api/github/repos/42', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false, title: 'Linux Kernel' }),
      }),
      { params: Promise.resolve({ id: '42' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.enabled).toBe(false);
    expect(updateGithubSubscriptionServiceMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ feedId: '42', enabled: false, userId: '1' }),
    );
  });

  it('PATCH rejects non-release content types', async () => {
    const mod = await import('../../../../../../app/api/github/repos/[id]/route');
    const response = await mod.PATCH(
      new Request('http://localhost/api/github/repos/42', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentTypes: ['pr'] }),
      }),
      { params: Promise.resolve({ id: '42' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.fields.contentTypes).toBe('unsupported_in_mvp');
    expect(updateGithubSubscriptionServiceMock).not.toHaveBeenCalled();
  });

  it('PATCH returns 400 when id is missing', async () => {
    const mod = await import('../../../../../../app/api/github/repos/[id]/route');
    const response = await mod.PATCH(
      new Request('http://localhost/api/github/repos/', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      { params: Promise.resolve({ id: '' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.fields.id).toBeDefined();
  });

  it('PATCH returns 404 when subscription not found', async () => {
    updateGithubSubscriptionServiceMock.mockResolvedValue(null);

    const mod = await import('../../../../../../app/api/github/repos/[id]/route');
    const response = await mod.PATCH(
      new Request('http://localhost/api/github/repos/999', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      { params: Promise.resolve({ id: '999' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.code).toBe('not_found');
  });

  it('DELETE removes a subscription and returns its id', async () => {
    deleteGithubSubscriptionServiceMock.mockResolvedValue(true);

    const mod = await import('../../../../../../app/api/github/repos/[id]/route');
    const response = await mod.DELETE(new Request('http://localhost/api/github/repos/42'), {
      params: Promise.resolve({ id: '42' }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toEqual({ id: '42' });
    expect(deleteGithubSubscriptionServiceMock).toHaveBeenCalledWith(pool, '42', '1');
  });

  it('DELETE returns 404 when subscription not found', async () => {
    deleteGithubSubscriptionServiceMock.mockResolvedValue(false);

    const mod = await import('../../../../../../app/api/github/repos/[id]/route');
    const response = await mod.DELETE(new Request('http://localhost/api/github/repos/999'), {
      params: Promise.resolve({ id: '999' }),
    });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.code).toBe('not_found');
  });

  it('DELETE returns 400 when id is missing', async () => {
    const mod = await import('../../../../../../app/api/github/repos/[id]/route');
    const response = await mod.DELETE(new Request('http://localhost/api/github/repos/'), {
      params: Promise.resolve({ id: '' }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.fields.id).toBeDefined();
  });
});
