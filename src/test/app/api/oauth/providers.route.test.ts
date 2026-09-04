/**
 * T04 路由测试：/api/oauth/providers（GET 列表）与 /api/oauth/providers/:provider（PUT 保存 / DELETE 清除）。
 *
 * 覆盖验收项（docs/arch-oauth-hub.md §T04）：
 * - GET 列表含「未配置」引导态（微信/抖音/小红书在本机的默认表现，AQ-3）；
 * - PUT 保存后响应体只有 `maskedClientSecret`，整棵树里搜不到明文 / 密文（安全红线 2）；
 * - DELETE 清除回到未配置态；
 * - provider 非法 → 400 validation_error；
 * - 未登录 → 401。
 *
 * 测试方式：mock 领域服务 `oauthConfigService`，直接 import route handler
 * （与 `src/test/app/api/github/repos/route.test.ts` 同风格）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthProviderConfigStatus } from '@/types';

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const getProviderConfigStatusesMock = vi.fn();
const saveProviderConfigMock = vi.fn();
const clearProviderConfigMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/oauth/services/oauthConfigService', () => ({
  getProviderConfigStatuses: (...args: unknown[]) => getProviderConfigStatusesMock(...args),
  saveProviderConfig: (...args: unknown[]) => saveProviderConfigMock(...args),
  clearProviderConfig: (...args: unknown[]) => clearProviderConfigMock(...args),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

const PLAIN_SECRET = 'gh-super-secret-value-9527';

function makeStatus(overrides: Partial<OAuthProviderConfigStatus> = {}): OAuthProviderConfigStatus {
  return {
    provider: 'github',
    displayName: 'GitHub',
    configured: true,
    clientId: 'Iv1.abcdef',
    maskedClientSecret: 'gh-s****9527',
    enabled: true,
    redirectUri: 'https://feedfuse.test/api/oauth/callback/github',
    supportsPkce: true,
    requiresExactRedirectUri: false,
    ...overrides,
  };
}

describe('/api/oauth/providers', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET 返回四平台配置状态，未配置平台也在列表里呈引导态', async () => {
    getProviderConfigStatusesMock.mockResolvedValue([
      makeStatus(),
      makeStatus({
        provider: 'wechat',
        displayName: '微信',
        configured: false,
        clientId: '',
        maskedClientSecret: null,
        requiresExactRedirectUri: true,
      }),
      makeStatus({
        provider: 'douyin',
        displayName: '抖音',
        configured: false,
        clientId: '',
        maskedClientSecret: null,
      }),
      makeStatus({
        provider: 'xiaohongshu',
        displayName: '小红书',
        configured: false,
        clientId: '',
        maskedClientSecret: null,
      }),
    ]);

    const mod = await import('../../../../app/api/oauth/providers/route');
    const response = await mod.GET(new Request('http://localhost/api/oauth/providers'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toHaveLength(4);
    expect(getProviderConfigStatusesMock).toHaveBeenCalledWith(pool, expect.anything());

    const wechat = json.data.find((item: OAuthProviderConfigStatus) => item.provider === 'wechat');
    expect(wechat.configured).toBe(false);
    expect(wechat.maskedClientSecret).toBeNull();
  });

  it('GET 响应体全量断言不含 secret 明文与密文', async () => {
    getProviderConfigStatusesMock.mockResolvedValue([makeStatus()]);

    const mod = await import('../../../../app/api/oauth/providers/route');
    const response = await mod.GET(new Request('http://localhost/api/oauth/providers'));
    const raw = await response.text();

    expect(raw).not.toContain(PLAIN_SECRET);
    // 密文带 secretBox 版本前缀，同样不得出现在对外 DTO 里。
    expect(raw).not.toContain('v1:');
    expect(raw).toContain('gh-s****9527');
  });

  it('GET 未登录返回 401', async () => {
    requireApiSessionMock.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) });

    const mod = await import('../../../../app/api/oauth/providers/route');
    const response = await mod.GET(new Request('http://localhost/api/oauth/providers'));

    expect(response.status).toBe(401);
    expect(getProviderConfigStatusesMock).not.toHaveBeenCalled();
  });

  it('PUT 保存配置，响应体只有打码 secret，不返回明文', async () => {
    saveProviderConfigMock.mockResolvedValue(makeStatus());

    const mod = await import('../../../../app/api/oauth/providers/[provider]/route');
    const response = await mod.PUT(
      new Request('http://localhost/api/oauth/providers/github', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'Iv1.abcdef', clientSecret: PLAIN_SECRET }),
      }),
      { params: Promise.resolve({ provider: 'github' }) },
    );
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(saveProviderConfigMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ provider: 'github', clientId: 'Iv1.abcdef' }),
      expect.anything(),
    );
    expect(raw).not.toContain(PLAIN_SECRET);
    expect(raw).not.toContain('v1:');
    expect(raw).toContain('gh-s****9527');
  });

  it('PUT provider 非法返回 400，不调用服务层', async () => {
    const mod = await import('../../../../app/api/oauth/providers/[provider]/route');
    const response = await mod.PUT(
      new Request('http://localhost/api/oauth/providers/evil', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'Iv1.abcdef' }),
      }),
      { params: Promise.resolve({ provider: 'evil' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.provider).toBe('不支持的平台');
    expect(saveProviderConfigMock).not.toHaveBeenCalled();
  });

  it('DELETE 清除配置回到未配置态', async () => {
    clearProviderConfigMock.mockResolvedValue(
      makeStatus({ configured: false, clientId: '', maskedClientSecret: null }),
    );

    const mod = await import('../../../../app/api/oauth/providers/[provider]/route');
    const response = await mod.DELETE(new Request('http://localhost/api/oauth/providers/wechat'), {
      params: Promise.resolve({ provider: 'wechat' }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(clearProviderConfigMock).toHaveBeenCalledWith(pool, 'wechat', expect.anything());
    expect(json.data.configured).toBe(false);
    expect(json.data.maskedClientSecret).toBeNull();
  });

  it('DELETE provider 非法返回 400', async () => {
    const mod = await import('../../../../app/api/oauth/providers/[provider]/route');
    const response = await mod.DELETE(new Request('http://localhost/api/oauth/providers/evil'), {
      params: Promise.resolve({ provider: 'evil' }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(clearProviderConfigMock).not.toHaveBeenCalled();
  });

  it('PUT 未登录返回 401', async () => {
    requireApiSessionMock.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) });

    const mod = await import('../../../../app/api/oauth/providers/[provider]/route');
    const response = await mod.PUT(
      new Request('http://localhost/api/oauth/providers/github', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'Iv1.abcdef' }),
      }),
      { params: Promise.resolve({ provider: 'github' }) },
    );

    expect(response.status).toBe(401);
    expect(saveProviderConfigMock).not.toHaveBeenCalled();
  });
});
