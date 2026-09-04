import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubApiError } from '@/server/integrations/github/githubErrors';

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const getGithubTokenStatusMock = vi.fn();
const setGithubTokenMock = vi.fn();
const clearGithubTokenMock = vi.fn();
const probeRateLimitMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/github/services/githubTokenService', () => ({
  clearGithubToken: (...args: unknown[]) => clearGithubTokenMock(...args),
  getGithubTokenStatus: (...args: unknown[]) => getGithubTokenStatusMock(...args),
  setGithubToken: (...args: unknown[]) => setGithubTokenMock(...args),
}));

vi.mock('@/server/integrations/github/githubClient', () => ({
  probeRateLimit: (...args: unknown[]) => probeRateLimitMock(...args),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

function tokenStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hasToken: false,
    maskedToken: null,
    rateLimit: null,
    ...overrides,
  };
}

describe('/api/settings/github/token', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    getGithubTokenStatusMock.mockResolvedValue(tokenStatus());
    setGithubTokenMock.mockResolvedValue(undefined);
    clearGithubTokenMock.mockResolvedValue(undefined);
    probeRateLimitMock.mockResolvedValue({ status: 200, rateLimit: { limit: 5000, remaining: 4999 } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET returns the masked token status (no plaintext)', async () => {
    getGithubTokenStatusMock.mockResolvedValue(
      tokenStatus({ hasToken: true, maskedToken: 'ghp_****cdef' }),
    );

    const mod = await import('../../../../../../app/api/settings/github/token/route');
    const response = await mod.GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.hasToken).toBe(true);
    expect(json.data.maskedToken).toBe('ghp_****cdef');
  });

  it('PUT saves a valid token after a successful rate-limit probe', async () => {
    const mod = await import('../../../../../../app/api/settings/github/token/route');
    const response = await mod.PUT(
      new Request('http://localhost/api/settings/github/token', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'ghp_' + 'a'.repeat(36) }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(probeRateLimitMock).toHaveBeenCalledTimes(1);
    expect(setGithubTokenMock).toHaveBeenCalledWith(pool, '1', 'ghp_' + 'a'.repeat(36));
  });

  it('PUT rejects an empty token', async () => {
    const mod = await import('../../../../../../app/api/settings/github/token/route');
    const response = await mod.PUT(
      new Request('http://localhost/api/settings/github/token', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: '   ' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.token).toBeDefined();
    expect(setGithubTokenMock).not.toHaveBeenCalled();
  });

  it('PUT rejects a malformed token prefix', async () => {
    const mod = await import('../../../../../../app/api/settings/github/token/route');
    const response = await mod.PUT(
      new Request('http://localhost/api/settings/github/token', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-token' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.fields.token).toMatch(/前缀/);
    expect(setGithubTokenMock).not.toHaveBeenCalled();
  });

  it('PUT rejects an invalid token without persisting it', async () => {
    probeRateLimitMock.mockRejectedValue(new GithubApiError('unauthorized'));

    const mod = await import('../../../../../../app/api/settings/github/token/route');
    const response = await mod.PUT(
      new Request('http://localhost/api/settings/github/token', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'ghp_' + 'b'.repeat(36) }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.token).toBe('invalid');
    expect(setGithubTokenMock).not.toHaveBeenCalled();
  });

  it('DELETE clears the token and returns empty status', async () => {
    const mod = await import('../../../../../../app/api/settings/github/token/route');
    const response = await mod.DELETE(new Request('http://localhost/api/settings/github/token'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(clearGithubTokenMock).toHaveBeenCalledWith(pool, '1');
  });
});
