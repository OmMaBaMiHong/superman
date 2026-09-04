/**
 * T04 路由测试：GET /api/oauth/callback/:provider。
 *
 * 本路由唯一非 JSON 路由，**永远 302**（docs/arch-oauth-hub.md §3.3 回调重定向契约）：
 *   成功: {returnTo}?settings=oauth&oauth=success&provider={provider}
 *   取消: {returnTo}?settings=oauth&oauth=denied&provider={provider}
 *   失败: {returnTo}?settings=oauth&oauth=failed&provider={provider}&reason={kind}
 *
 * 覆盖验收项：
 * - state 校验失败 → 302 + reason=invalid_state；
 * - code 换 token 成功 → 302 + oauth=success；
 * - 用户取消（denied）→ 302 + oauth=denied（不带 reason）；
 * - provider 错误归一（如微信 errcode → provider_error）→ 302 + reason=provider_error；
 * - 平台标识非法 → 302 回默认路径 + reason=invalid_state；
 * - 未登录 → 302（回站内），绝不返回 401 JSON。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const handleCallbackMock = vi.fn();
const normalizeCallbackErrorMock = vi.fn();
const resolveCallbackReturnToMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/oauth/services/oauthCallbackService', () => ({
  handleCallback: (...args: unknown[]) => handleCallbackMock(...args),
  normalizeCallbackError: (...args: unknown[]) => normalizeCallbackErrorMock(...args),
  resolveCallbackReturnTo: (...args: unknown[]) => resolveCallbackReturnToMock(...args),
}));

// buildCallbackRedirectUrl 走真实 redirectUri 实现，需固定 FEEDFUSE_PUBLIC_BASE_URL。
vi.mock('@/server/infra/env', () => ({
  getServerEnv: () => ({ FEEDFUSE_PUBLIC_BASE_URL: 'https://feedfuse.test' }),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

function callbackRequest(provider: string, query: string): Request {
  return new Request(`http://localhost/api/oauth/callback/${provider}?${query}`);
}

function paramsOf(provider: string): { params: Promise<{ provider: string }> } {
  return { params: Promise.resolve({ provider }) };
}

function locationOf(response: Response): string {
  const location = response.headers.get('location');
  expect(location).not.toBeNull();
  return location ?? '';
}

describe('/api/oauth/callback/:provider', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    // 默认让 normalizeCallbackError 原样透传 OAuthError，路由按 kind 分流。
    normalizeCallbackErrorMock.mockImplementation((err: unknown) =>
      err instanceof OAuthError ? err : new OAuthError('provider_error'),
    );
    resolveCallbackReturnToMock.mockReturnValue('/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('code 换 token 成功 → 302 回站内并带 oauth=success', async () => {
    handleCallbackMock.mockResolvedValue({
      provider: 'github',
      connectionId: '42',
      returnTo: '/',
    });

    const mod = await import('../../../../app/api/oauth/callback/[provider]/route');
    const response = await mod.GET(
      callbackRequest('github', 'code=abc123&state=randState'),
      paramsOf('github'),
    );
    const location = locationOf(response);

    expect(response.status).toBe(302);
    expect(handleCallbackMock).toHaveBeenCalledWith(pool, {
      userId: '1',
      provider: 'github',
      code: 'abc123',
      state: 'randState',
      error: null,
    });
    expect(location).toContain('settings=oauth');
    expect(location).toContain('oauth=success');
    expect(location).toContain('provider=github');
  });

  it('state 校验失败 → 302 + reason=invalid_state', async () => {
    handleCallbackMock.mockRejectedValue(new OAuthError('invalid_state', { provider: 'github' }));

    const mod = await import('../../../../app/api/oauth/callback/[provider]/route');
    const response = await mod.GET(
      callbackRequest('github', 'code=abc123&state=replayedState'),
      paramsOf('github'),
    );
    const location = locationOf(response);

    expect(response.status).toBe(302);
    expect(location).toContain('oauth=failed');
    expect(location).toContain('reason=invalid_state');
  });

  it('用户取消（denied）→ 302 + oauth=denied，且不带 reason', async () => {
    handleCallbackMock.mockRejectedValue(new OAuthError('user_denied', { provider: 'github' }));

    const mod = await import('../../../../app/api/oauth/callback/[provider]/route');
    const response = await mod.GET(
      callbackRequest('github', 'error=access_denied&state=randState'),
      paramsOf('github'),
    );
    const location = locationOf(response);

    expect(response.status).toBe(302);
    expect(location).toContain('oauth=denied');
    expect(location).not.toContain('reason=');
  });

  it('provider 业务错误归一（微信 errcode）→ 302 + reason=provider_error', async () => {
    handleCallbackMock.mockRejectedValue(new OAuthError('provider_error', { provider: 'wechat' }));

    const mod = await import('../../../../app/api/oauth/callback/[provider]/route');
    const response = await mod.GET(
      callbackRequest('wechat', 'code=wxcode&state=randState'),
      paramsOf('wechat'),
    );
    const location = locationOf(response);

    expect(response.status).toBe(302);
    expect(location).toContain('oauth=failed');
    expect(location).toContain('reason=provider_error');
    // 平台原始错误细节绝不进 URL。
    expect(location).not.toContain('errcode');
    expect(location).not.toContain('40029');
  });

  it('平台标识非法 → 302 回默认路径 + reason=invalid_state，且不调用服务', async () => {
    const mod = await import('../../../../app/api/oauth/callback/[provider]/route');
    const response = await mod.GET(callbackRequest('evil', 'code=abc'), paramsOf('evil'));
    const location = locationOf(response);

    expect(response.status).toBe(302);
    expect(location).toContain('oauth=failed');
    expect(location).toContain('reason=invalid_state');
    expect(handleCallbackMock).not.toHaveBeenCalled();
  });

  it('未登录 → 302 回站内（绝不返回 401 JSON）', async () => {
    requireApiSessionMock.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) });

    const mod = await import('../../../../app/api/oauth/callback/[provider]/route');
    const response = await mod.GET(
      callbackRequest('github', 'code=abc123&state=randState'),
      paramsOf('github'),
    );
    const location = locationOf(response);

    expect(response.status).toBe(302);
    expect(location).toContain('oauth=failed');
    expect(location).toContain('reason=invalid_state');
    expect(handleCallbackMock).not.toHaveBeenCalled();
  });
});
