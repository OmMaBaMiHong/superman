/**
 * T04 路由测试：/api/oauth/connections（GET 列表）、/api/oauth/connections/:id（DELETE 撤销）、
 * /api/oauth/connections/:id/refresh（POST 刷新）。
 *
 * 覆盖验收项（docs/arch-oauth-hub.md §3.3 / §4.3）：
 * - GET 列表为打码态 DTO（`OAuthConnectionView` 结构性无 token 字段，整棵树搜不到凭据）；
 * - DELETE 撤销成功返回 { id }，id 缺失 → 400；
 * - POST 刷新成功返回更新后的连接视图；
 * - POST 刷新失败 → 502 + oauth_refresh_failed（服务层负责置 expired，路由只做错误归一）；
 * - 未登录 → 401。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthError } from '@/server/integrations/oauth/oauthErrors';
import type { OAuthConnectionView } from '@/types';

const pool = { query: vi.fn(), connect: vi.fn() };
const requireApiSessionMock = vi.fn();
const listConnectionsMock = vi.fn();
const revokeConnectionMock = vi.fn();
const refreshConnectionMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/oauth/services/oauthConnectionService', () => ({
  listConnections: (...args: unknown[]) => listConnectionsMock(...args),
  revokeConnection: (...args: unknown[]) => revokeConnectionMock(...args),
  refreshConnection: (...args: unknown[]) => refreshConnectionMock(...args),
}));

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

function makeView(overrides: Partial<OAuthConnectionView> = {}): OAuthConnectionView {
  return {
    id: '42',
    provider: 'github',
    status: 'active',
    displayName: 'octocat',
    avatarUrl: null,
    authorizedAt: '2025-03-01T00:00:00.000Z',
    accessTokenExpiresAt: null,
    canRefresh: false,
    ...overrides,
  };
}

describe('/api/oauth/connections', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET 返回当前用户连接列表（打码态，无任何 token 字段）', async () => {
    listConnectionsMock.mockResolvedValue([
      makeView(),
      makeView({ id: '43', provider: 'wechat', status: 'expired', canRefresh: false }),
    ]);

    const mod = await import('../../../../app/api/oauth/connections/route');
    const response = await mod.GET();
    const raw = await response.text();
    const json = JSON.parse(raw);

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(listConnectionsMock).toHaveBeenCalledWith(pool, '1');

    // 结构性无凭据：每个元素的键必须是 DTO 白名单，绝不允许任何 token 字段。
    const allowedKeys = [
      'id',
      'provider',
      'status',
      'displayName',
      'avatarUrl',
      'authorizedAt',
      'accessTokenExpiresAt',
      'canRefresh',
    ];
    for (const view of json.data as Record<string, unknown>[]) {
      expect(Object.keys(view).sort()).toEqual([...allowedKeys].sort());
    }
    // 再兜底一层：整棵树里不该出现密文前缀或加密列命名。
    expect(raw).not.toContain('_encrypted');
    expect(raw).not.toContain('v1:');
  });

  it('GET 未登录返回 401', async () => {
    requireApiSessionMock.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) });

    const mod = await import('../../../../app/api/oauth/connections/route');
    const response = await mod.GET();

    expect(response.status).toBe(401);
    expect(listConnectionsMock).not.toHaveBeenCalled();
  });

  it('DELETE 撤销连接返回 { id }，并带 user_id 谓词调用服务', async () => {
    revokeConnectionMock.mockResolvedValue({ id: '42' });

    const mod = await import('../../../../app/api/oauth/connections/[id]/route');
    const response = await mod.DELETE(new Request('http://localhost/api/oauth/connections/42'), {
      params: Promise.resolve({ id: '42' }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe('42');
    expect(revokeConnectionMock).toHaveBeenCalledWith(pool, '1', '42');
  });

  it('DELETE id 缺失返回 400', async () => {
    const mod = await import('../../../../app/api/oauth/connections/[id]/route');
    const response = await mod.DELETE(new Request('http://localhost/api/oauth/connections/'), {
      params: Promise.resolve({ id: '   ' }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.id).toBe('缺少连接 id');
    expect(revokeConnectionMock).not.toHaveBeenCalled();
  });

  it('POST 刷新成功返回更新后的连接视图', async () => {
    refreshConnectionMock.mockResolvedValue(
      makeView({
        id: '42',
        accessTokenExpiresAt: '2025-04-01T00:00:00.000Z',
        canRefresh: true,
      }),
    );

    const mod = await import('../../../../app/api/oauth/connections/[id]/refresh/route');
    const response = await mod.POST(new Request('http://localhost/api/oauth/connections/42/refresh'), {
      params: Promise.resolve({ id: '42' }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe('42');
    expect(json.data.canRefresh).toBe(true);
    expect(refreshConnectionMock).toHaveBeenCalledWith(pool, '1', '42');
  });

  it('POST 刷新失败 → 502 + oauth_refresh_failed（服务层已置 expired，路由做错误归一）', async () => {
    refreshConnectionMock.mockRejectedValue(new OAuthError('refresh_failed', { provider: 'github' }));

    const mod = await import('../../../../app/api/oauth/connections/[id]/refresh/route');
    const response = await mod.POST(new Request('http://localhost/api/oauth/connections/42/refresh'), {
      params: Promise.resolve({ id: '42' }),
    });
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('oauth_refresh_failed');
    expect(json.error.message).toContain('刷新');
  });
});
