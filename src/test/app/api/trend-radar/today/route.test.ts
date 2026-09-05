import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = { query: vi.fn() };
const requireApiSessionMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

import { GET } from '@/app/api/trend-radar/today/route';

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    platform: 'weibo',
    platformName: '微博',
    title: '热搜',
    url: 'https://s.weibo.com/a',
    rank: 1,
    hotValue: '',
    firstSeenAt: '2026-09-05T02:00:00Z',
    lastSeenAt: '2026-09-05T03:00:00Z',
    sourceDate: '2026-09-05',
    promotedAt: null,
    promotedArticleId: null,
    payload: {},
    ...overrides,
  };
}

describe('/api/trend-radar/today', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按平台分组返回当日热榜', async () => {
    pool.query.mockResolvedValue({
      rows: [
        itemRow({ id: '1', platform: 'weibo', platformName: '微博', title: '微博热搜A' }),
        itemRow({ id: '2', platform: 'weibo', platformName: '微博', title: '微博热搜B', rank: 2 }),
        itemRow({ id: '3', platform: 'zhihu', platformName: '知乎', title: '知乎热题' }),
      ],
    });

    const res = await GET(new Request('http://localhost/api/trend-radar/today'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(3);
    expect(json.data.platforms).toHaveLength(2);
    const weibo = json.data.platforms.find((g: { platform: string }) => g.platform === 'weibo');
    expect(weibo.items).toHaveLength(2);
    expect(weibo.platformName).toBe('微博');
    // user 隔离：SQL 带 user_id 过滤
    expect(String(pool.query.mock.calls[0][0])).toContain('user_id = $1');
    expect(pool.query.mock.calls[0][1]).toContain('1');
  });

  it('非法 date 参数 → 400', async () => {
    const res = await GET(new Request('http://localhost/api/trend-radar/today?date=09-05'));
    expect(res.status).toBe(400);
  });

  it('未登录 → 透传鉴权响应', async () => {
    requireApiSessionMock.mockResolvedValue({
      response: Response.json(
        { ok: false, error: { code: 'unauthorized' } },
        { status: 401 },
      ),
    });
    const res = await GET(new Request('http://localhost/api/trend-radar/today'));
    expect(res.status).toBe(401);
  });
});
