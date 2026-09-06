import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

const registerMock = vi.fn();
const refreshMock = vi.fn();
const listWithMetricsMock = vi.fn();
const getPostMock = vi.fn();
const listSnapshotsSinceMock = vi.fn();
const setTrackingMock = vi.fn();
const deletePostMock = vi.fn();

vi.mock('@/core/publish-tracking/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/publish-tracking/service')>();
  return {
    ...original,
    registerPublishedPost: (...args: unknown[]) => registerMock(...args),
    refreshPublishedPost: (...args: unknown[]) => refreshMock(...args),
  };
});
vi.mock('@/core/publish-tracking/repository', () => ({
  listPublishedPostsWithMetrics: (...args: unknown[]) => listWithMetricsMock(...args),
  getPublishedPost: (...args: unknown[]) => getPostMock(...args),
  listSnapshotsSince: (...args: unknown[]) => listSnapshotsSinceMock(...args),
  setPublishedPostTracking: (...args: unknown[]) => setTrackingMock(...args),
  deletePublishedPost: (...args: unknown[]) => deletePostMock(...args),
}));

vi.mock('@/core/governance/repository', () => ({
  listGovernanceQueue: vi.fn(async () => ({ items: [], total: 0 })),
  getGovernanceStats: vi.fn(async () => ({})),
  getGovernanceItemDetail: vi.fn(async () => null),
}));
vi.mock('@/core/governance/services/governanceActionsService', () => ({
  approveGovernanceItem: vi.fn(),
  rejectGovernanceItem: vi.fn(),
  redraftGovernanceItem: vi.fn(),
  restoreGovernanceItem: vi.fn(),
  requeueGovernanceItem: vi.fn(),
}));
vi.mock('@/core/governance/directions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/governance/directions')>();
  return {
    ...original,
    listDirectionStrategies: vi.fn(async () => []),
    createDirectionStrategy: vi.fn(),
    updateDirectionStrategy: vi.fn(),
    deleteDirectionStrategy: vi.fn(),
  };
});
vi.mock('@/core/governance/backfill', () => ({ backfillDirections: vi.fn() }));
vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: vi.fn(async () => ({})),
  getAiApiKey: vi.fn(async () => ''),
}));
vi.mock('@/server/integrations/rss/ssrfGuard', () => ({ isSafeExternalUrl: vi.fn(async () => true) }));
vi.mock('@/server/domains/feeds/services/feedCategoryLifecycleService', () => ({
  createFeedWithCategoryResolution: vi.fn(),
}));
vi.mock('@/core/notify/repository', () => ({
  listNotifications: vi.fn(async () => ({ items: [], total: 0 })),
  countUnreadNotifications: vi.fn(async () => 0),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('@/core/notify/service', () => ({ notify: vi.fn(), notifyOncePerWindow: vi.fn() }));
vi.mock('@/core/trendradar/repository', () => ({ listTrendRadarItemsByDate: vi.fn(async () => []) }));
vi.mock('@/core/trendradar/promote', () => ({ promoteTrendRadarItem: vi.fn() }));
vi.mock('@/core/pipelines/services/pipelineService', () => ({
  createRewriteJobs: vi.fn(),
  retryPipelineJob: vi.fn(),
}));
vi.mock('@/core/pipelines/repository', () => ({
  listPipelineJobs: vi.fn(async () => ({ items: [], total: 0 })),
  listDrafts: vi.fn(async () => ({ items: [], total: 0 })),
  getDraftDetail: vi.fn(async () => null),
  acceptDraft: vi.fn(),
}));

interface MockRes {
  status: number | null;
  headers: Record<string, string>;
  body: string;
}

function makeRes() {
  const res: MockRes = { status: null, headers: {}, body: '' };
  return Object.assign(res, {
    writeHead(status: number, headers?: Record<string, string>) {
      res.status = status;
      if (headers) Object.assign(res.headers, headers);
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    end(body?: string | Buffer) {
      if (body) res.body += body.toString();
    },
  });
}

function makeReq(method: string, url: string, cookie?: string, payload?: unknown) {
  if (method === 'POST' || method === 'PUT') {
    const req = Readable.from([Buffer.from(JSON.stringify(payload ?? {}))]) as Readable & {
      method: string; url: string; headers: Record<string, string>;
    };
    req.method = method;
    req.url = url;
    req.headers = cookie ? { cookie } : {};
    return req as never;
  }
  const req = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> };
  req.method = method;
  req.url = url;
  req.headers = cookie ? { cookie } : {};
  return req as never;
}

const fakeDb = { query: async () => ({ rows: [] }) };

function makeHandler() {
  const auth = createAuth({ db: null, secret: '' });
  const handler = createApiHandler({ auth, db: fakeDb, staticRoot: '/nonexistent' });
  return { auth, handler };
}

async function login(auth: ReturnType<typeof createAuth>): Promise<string> {
  const session = (await auth.login('admin', 'superman-dev'))!;
  const res = makeRes();
  auth.issueCookie(res as never, session);
  return `${SESSION_COOKIE}=${/superman_session=([^;]+)/.exec(res.headers['set-cookie'])![1]}`;
}

const POST = {
  id: '7', userId: '1', draftId: null, articleId: '11', platform: 'bilibili',
  accountName: '', postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD', title: '测试视频',
  publishedAt: null, trackingEnabled: true, lastFetchedAt: null, fetchFailCount: 0,
  lastError: null, lastHotNotifiedAt: null, createdAt: '2026-09-05', updatedAt: '2026-09-05',
};

describe('plugin/host/api · 发布表现追踪路由（P2d）', () => {
  it('未登录返回 401', async () => {
    const { handler } = makeHandler();
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/published-posts'), res as never);
    expect(res.status).toBe(401);
  });

  it('POST /published-posts 登记；重复 409 透传', async () => {
    registerMock.mockReset().mockResolvedValue(POST);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/published-posts', cookie, {
      postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      articleId: '11',
    }), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.post).toMatchObject({ id: '7', platform: 'bilibili' });
    expect(registerMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      articleId: '11',
      userId: '1',
    }));

    const { ConflictError } = await import('@/server/infra/http/errors');
    registerMock.mockRejectedValue(new ConflictError('该链接已登记'));
    const dup = makeRes();
    await handler(makeReq('POST', '/s/api/published-posts', cookie, {
      postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    }), dup as never);
    expect(dup.status).toBe(409);
  });

  it('GET /published-posts 列表带最新快照/24h 增量/hot 标记', async () => {
    listWithMetricsMock.mockReset().mockResolvedValue([{
      ...POST,
      latestSnapshot: { id: 's2', postId: '7', fetchedAt: '2026-09-05T12:00:00Z', views: 3000, likes: 150, comments: 10, shares: null, favorites: null, coins: null, followersDelta: null, rawJson: null },
      baselineSnapshot: { id: 's1', postId: '7', fetchedAt: '2026-09-04T14:00:00Z', views: 2000, likes: 40, comments: 5, shares: null, favorites: null, coins: null, followersDelta: null, rawJson: null },
    }]);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/published-posts', cookie), res as never);
    expect(res.status).toBe(200);
    const item = JSON.parse(res.body).data.items[0];
    expect(item.delta24h).toEqual({ views: 1000, likes: 110, comments: 5 });
    expect(item.hot).toBe(true);
    expect(item.hotReasons.length).toBeGreaterThan(0);
    expect(listWithMetricsMock).toHaveBeenCalledWith(fakeDb, { userId: '1' });
  });

  it('GET /published-posts/:id 详情带 7 天快照；不存在 404', async () => {
    getPostMock.mockReset().mockResolvedValue(POST);
    listSnapshotsSinceMock.mockReset().mockResolvedValue([{ id: 's1' }]);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/published-posts/7', cookie), res as never);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.post.id).toBe('7');
    expect(body.data.snapshots).toHaveLength(1);
    expect(listSnapshotsSinceMock).toHaveBeenCalledWith(fakeDb, { postId: '7', days: 7 });

    getPostMock.mockResolvedValue(null);
    const nf = makeRes();
    await handler(makeReq('GET', '/s/api/published-posts/7', cookie), nf as never);
    expect(nf.status).toBe(404);
  });

  it('POST /published-posts/:id/refresh 立即抓一次', async () => {
    refreshMock.mockReset().mockResolvedValue({ ok: true, snapshotId: 's9', hot: false, hotReasons: [], hotNotified: false });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/published-posts/7/refresh', cookie, {}), res as never);
    expect(res.status).toBe(200);
    expect(refreshMock).toHaveBeenCalledWith(fakeDb, { postId: '7', userId: '1' });

    refreshMock.mockResolvedValue({ ok: false, error: '帖子不存在或不属于当前用户' });
    const nf = makeRes();
    await handler(makeReq('POST', '/s/api/published-posts/7/refresh', cookie, {}), nf as never);
    expect(nf.status).toBe(404);
  });

  it('POST /published-posts/:id/tracking 启停；DELETE 删除', async () => {
    setTrackingMock.mockReset().mockResolvedValue({ ...POST, trackingEnabled: false });
    deletePostMock.mockReset().mockResolvedValue(true);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);

    const toggle = makeRes();
    await handler(makeReq('POST', '/s/api/published-posts/7/tracking', cookie, { trackingEnabled: false }), toggle as never);
    expect(toggle.status).toBe(200);
    expect(setTrackingMock).toHaveBeenCalledWith(fakeDb, { id: '7', trackingEnabled: false, userId: '1' });

    const badBody = makeRes();
    await handler(makeReq('POST', '/s/api/published-posts/7/tracking', cookie, {}), badBody as never);
    expect(badBody.status).toBe(400);

    const del = makeRes();
    await handler(makeReq('DELETE', '/s/api/published-posts/7', cookie), del as never);
    expect(del.status).toBe(200);
    deletePostMock.mockResolvedValue(false);
    const nf = makeRes();
    await handler(makeReq('DELETE', '/s/api/published-posts/7', cookie), nf as never);
    expect(nf.status).toBe(404);
  });
});
