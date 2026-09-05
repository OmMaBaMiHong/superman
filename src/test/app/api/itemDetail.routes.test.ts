import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = { query: vi.fn() };
const requireApiSessionMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));

import { GET as getGovernanceItem } from '@/app/api/governance/items/[id]/route';
import { GET as getTrendRadarItem } from '@/app/api/trend-radar/items/[id]/route';

const okSession = { userId: '1', role: 'admin', sessionVersion: 1 } as const;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const detailRow = {
  id: '891241',
  title: 'AI 拟折标题',
  titleOriginal: '原标题',
  author: '作者甲',
  content: '<p>全文</p>',
  previewImage: null,
  summary: '摘要',
  aiReason: '理由',
  qualityScore: 88,
  feedId: '10',
  feedTitle: '示例源',
  categoryId: 'c1',
  categoryTitle: '技术',
  publishedAt: '2026-09-05T00:00:00Z',
  sourceUrl: 'https://example.com/a1',
  governanceStatus: 'candidate',
  redraftCount: 0,
  feedView: 'article',
  hasPreviewImage: false,
  hasInlineImage: true,
};

const trendRow = {
  id: '7',
  platform: 'douyin',
  platformName: '抖音',
  title: '热搜',
  url: 'https://www.douyin.com/hot/1',
  rank: 3,
  hotValue: '999万',
  firstSeenAt: '2026-09-05T02:00:00Z',
  lastSeenAt: '2026-09-05T03:00:00Z',
  sourceDate: '2026-09-05',
  promotedAt: null,
  promotedArticleId: null,
  payload: { previousRank: 5, note: 'webhook 写入' },
};

describe('GET /api/governance/items/[id]', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    pool.query.mockResolvedValue({ rows: [detailRow] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('返回全文详情并推断 contentType（内嵌图 → image）', async () => {
    const res = await getGovernanceItem(
      new Request('http://localhost/api/governance/items/891241'),
      makeContext('891241'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe('891241');
    expect(json.data.content).toBe('<p>全文</p>');
    expect(json.data.contentType).toBe('image');
    // 信号位不外泄
    expect(json.data.hasInlineImage).toBeUndefined();
    expect(json.data.feedView).toBeUndefined();
    // userId 隔离：SQL 参数带 session userId
    expect(pool.query.mock.calls[0][1]).toEqual(['891241', '1']);
  });

  it('id 非数字 → 400', async () => {
    const res = await getGovernanceItem(
      new Request('http://localhost/api/governance/items/abc'),
      makeContext('abc'),
    );
    expect(res.status).toBe(400);
  });

  it('条目不存在 → 404', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await getGovernanceItem(
      new Request('http://localhost/api/governance/items/999'),
      makeContext('999'),
    );
    expect(res.status).toBe(404);
  });

  it('未登录 → 401', async () => {
    requireApiSessionMock.mockResolvedValue({
      response: Response.json({ ok: false, error: { code: 'unauthorized', message: 'x' } }, { status: 401 }),
    });
    const res = await getGovernanceItem(
      new Request('http://localhost/api/governance/items/1'),
      makeContext('1'),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/trend-radar/items/[id]', () => {
  beforeEach(() => {
    requireApiSessionMock.mockResolvedValue(okSession);
    pool.query.mockResolvedValue({ rows: [trendRow] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('返回行字段 + payload 全量，并推断 contentType（抖音 → video）', async () => {
    const res = await getTrendRadarItem(
      new Request('http://localhost/api/trend-radar/items/7'),
      makeContext('7'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe('热搜');
    expect(json.data.payload).toEqual({ previousRank: 5, note: 'webhook 写入' });
    expect(json.data.previousRank).toBe(5);
    expect(json.data.contentType).toBe('video');
    expect(pool.query.mock.calls[0][1]).toEqual(['7', '1']);
  });

  it('条目不存在 → 404；id 非法 → 400', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const notFound = await getTrendRadarItem(
      new Request('http://localhost/api/trend-radar/items/999'),
      makeContext('999'),
    );
    expect(notFound.status).toBe(404);

    const bad = await getTrendRadarItem(
      new Request('http://localhost/api/trend-radar/items/abc'),
      makeContext('abc'),
    );
    expect(bad.status).toBe(400);
  });
});
