import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = { query: vi.fn() };
const requireApiSessionMock = vi.fn();
const promoteMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

vi.mock('@/server/domains/trendradar/promote', () => ({
  promoteTrendRadarItem: (...args: unknown[]) => promoteMock(...args),
}));

import { POST } from '@/app/api/trend-radar/items/[id]/promote/route';

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('/api/trend-radar/items/[id]/promote', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    promoteMock.mockResolvedValue({ ok: true, articleId: '891', alreadyPromoted: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('转选题成功返回 articleId', async () => {
    const res = await POST(
      new Request('http://localhost/api/trend-radar/items/4/promote', { method: 'POST' }),
      makeContext('4'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ itemId: '4', articleId: '891', alreadyPromoted: false });
    expect(promoteMock).toHaveBeenCalledWith(pool, { id: '4', userId: '1' });
  });

  it('重复 promote 幂等（alreadyPromoted=true）', async () => {
    promoteMock.mockResolvedValue({ ok: true, articleId: '891', alreadyPromoted: true });
    const res = await POST(
      new Request('http://localhost/api/trend-radar/items/4/promote', { method: 'POST' }),
      makeContext('4'),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.alreadyPromoted).toBe(true);
  });

  it('条目不存在 → 404', async () => {
    promoteMock.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await POST(
      new Request('http://localhost/api/trend-radar/items/404/promote', { method: 'POST' }),
      makeContext('404'),
    );
    expect(res.status).toBe(404);
  });

  it('非法 id → 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/trend-radar/items/abc/promote', { method: 'POST' }),
      makeContext('abc'),
    );
    expect(res.status).toBe(400);
  });
});
