/**
 * T04 路由测试：POST /api/oauth/authorize。
 *
 * 覆盖验收项（docs/arch-oauth-hub.md §3.3 / §4.1）：
 * - 成功返回 `authorizeUrl`，其中含 `state` 与 PKCE `code_challenge` 参数；
 * - 平台未配置 client → 400 + `oauth_not_configured`（前端据此提示去填凭据）；
 * - provider 非法 / 缺失 → 400 validation_error；
 * - 未登录 → 401（不产生任何 state 记录）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const startAuthorizationMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/oauth/services/oauthAuthorizeService', () => ({
  startAuthorization: (...args: unknown[]) => startAuthorizationMock(...args),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

function authorizeUrlWithPkce(): string {
  return [
    'https://github.com/login/oauth/authorize',
    '?client_id=Iv1.abcdef',
    '&redirect_uri=https%3A%2F%2Ffeedfuse.test%2Fapi%2Foauth%2Fcallback%2Fgithub',
    '&scope=read%3Auser',
    '&state=randState123',
    '&code_challenge=randChallenge456',
    '&code_challenge_method=S256',
  ].join('');
}

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/oauth/authorize', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    startAuthorizationMock.mockResolvedValue({ authorizeUrl: authorizeUrlWithPkce() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST 成功返回 authorizeUrl，且含 state 与 code_challenge（S256）', async () => {
    const mod = await import('../../../../app/api/oauth/authorize/route');
    const response = await mod.POST(postJson('http://localhost/api/oauth/authorize', { provider: 'github' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.authorizeUrl).toContain('state=randState123');
    expect(json.data.authorizeUrl).toContain('code_challenge=randChallenge456');
    expect(json.data.authorizeUrl).toContain('code_challenge_method=S256');

    expect(startAuthorizationMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        userId: '1',
        provider: 'github',
        returnTo: null,
        headers: expect.anything(),
      }),
    );
  });

  it('POST 携带 returnTo 时透传给服务层', async () => {
    const mod = await import('../../../../app/api/oauth/authorize/route');
    const response = await mod.POST(
      postJson('http://localhost/api/oauth/authorize', { provider: 'github', returnTo: '/reader' }),
    );

    expect(response.status).toBe(200);
    expect(startAuthorizationMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ returnTo: '/reader' }),
    );
  });

  it('POST 平台未配置 client → 400 + oauth_not_configured（引导态错误）', async () => {
    startAuthorizationMock.mockRejectedValue(new OAuthError('not_configured', { provider: 'wechat' }));

    const mod = await import('../../../../app/api/oauth/authorize/route');
    const response = await mod.POST(postJson('http://localhost/api/oauth/authorize', { provider: 'wechat' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('oauth_not_configured');
    expect(json.error.message).toContain('未配置');
  });

  it('POST provider 非法返回 400 validation_error', async () => {
    const mod = await import('../../../../app/api/oauth/authorize/route');
    const response = await mod.POST(postJson('http://localhost/api/oauth/authorize', { provider: 'evil' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(startAuthorizationMock).not.toHaveBeenCalled();
  });

  it('POST provider 缺失返回 400 validation_error', async () => {
    const mod = await import('../../../../app/api/oauth/authorize/route');
    const response = await mod.POST(postJson('http://localhost/api/oauth/authorize', {}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(startAuthorizationMock).not.toHaveBeenCalled();
  });

  it('POST 未登录返回 401，不产生授权', async () => {
    requireApiSessionMock.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) });

    const mod = await import('../../../../app/api/oauth/authorize/route');
    const response = await mod.POST(postJson('http://localhost/api/oauth/authorize', { provider: 'github' }));

    expect(response.status).toBe(401);
    expect(startAuthorizationMock).not.toHaveBeenCalled();
  });
});
