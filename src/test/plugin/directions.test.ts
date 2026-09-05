import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

const listStrategiesMock = vi.fn();
const createStrategyMock = vi.fn();
const updateStrategyMock = vi.fn();
const deleteStrategyMock = vi.fn();

vi.mock('@/core/governance/directions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/governance/directions')>();
  return {
    ...original,
    listDirectionStrategies: (...args: unknown[]) => listStrategiesMock(...args),
    createDirectionStrategy: (...args: unknown[]) => createStrategyMock(...args),
    updateDirectionStrategy: (...args: unknown[]) => updateStrategyMock(...args),
    deleteDirectionStrategy: (...args: unknown[]) => deleteStrategyMock(...args),
  };
});

const listGovernanceQueueMock = vi.fn(async () => ({ items: [], total: 0 }));
vi.mock('@/core/governance/repository', () => ({
  listGovernanceQueue: (...args: unknown[]) => listGovernanceQueueMock(...args),
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

const STRATEGY = {
  id: '1', userId: '1', key: 'money', name: '搞钱', color: '#f59e0b', icon: '💰',
  keywordsDsl: '变现 副业', aiHint: '商机', quotaWeight: 30, enabled: true, sort: 20, builtin: true,
};

describe('plugin/host/api · 方向策略路由（P2b）', () => {
  it('未登录访问 /s/api/directions 返回 401', async () => {
    const { handler } = makeHandler();
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/directions'), res as never);
    expect(res.status).toBe(401);
  });

  it('GET /s/api/directions 返回启用模板（enabledOnly）', async () => {
    listStrategiesMock.mockResolvedValue([STRATEGY]);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/directions', cookie), res as never);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items[0]).toMatchObject({ key: 'money', name: '搞钱', builtin: true });
    expect(listStrategiesMock).toHaveBeenCalledWith(fakeDb, { userId: '1', enabledOnly: true });
  });

  it('GET /s/api/directions/all 返回全部模板含禁用', async () => {
    listStrategiesMock.mockResolvedValue([STRATEGY, { ...STRATEGY, key: 'old', enabled: false }]);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/directions/all', cookie), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.items).toHaveLength(2);
    expect(listStrategiesMock).toHaveBeenCalledWith(fakeDb, { userId: '1' });
  });

  it('POST /s/api/directions 新建自定义模板；key 非法 400；重复 409', async () => {
    createStrategyMock.mockResolvedValue({ ...STRATEGY, key: 'tools', builtin: false });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);

    const created = makeRes();
    await handler(makeReq('POST', '/s/api/directions', cookie, { key: 'tools', name: '工具', quotaWeight: 10 }), created as never);
    expect(created.status).toBe(200);
    expect(JSON.parse(created.body).data.item).toMatchObject({ key: 'tools', builtin: false });

    const badKey = makeRes();
    await handler(makeReq('POST', '/s/api/directions', cookie, { key: 'Tools', name: 'x' }), badKey as never);
    expect(badKey.status).toBe(400);

    createStrategyMock.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const dup = makeRes();
    await handler(makeReq('POST', '/s/api/directions', cookie, { key: 'tools', name: '工具' }), dup as never);
    expect(dup.status).toBe(409);
  });

  it('PUT /s/api/directions/:key 更新权重/启停（builtin 可改）', async () => {
    updateStrategyMock.mockResolvedValue({ ...STRATEGY, quotaWeight: 55 });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('PUT', '/s/api/directions/money', cookie, { quotaWeight: 55, enabled: false }), res as never);
    expect(res.status).toBe(200);
    expect(updateStrategyMock).toHaveBeenCalledWith(fakeDb, 'money', { userId: '1', quotaWeight: 55, enabled: false });

    updateStrategyMock.mockResolvedValue(null);
    const missing = makeRes();
    await handler(makeReq('PUT', '/s/api/directions/ghost', cookie, { quotaWeight: 10 }), missing as never);
    expect(missing.status).toBe(404);
  });

  it('DELETE /s/api/directions/:key：builtin 409，自建可删', async () => {
    deleteStrategyMock.mockResolvedValue('builtin');
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const builtinRes = makeRes();
    await handler(makeReq('DELETE', '/s/api/directions/topic', cookie), builtinRes as never);
    expect(builtinRes.status).toBe(409);

    deleteStrategyMock.mockResolvedValue('deleted');
    const okRes = makeRes();
    await handler(makeReq('DELETE', '/s/api/directions/tools', cookie), okRes as never);
    expect(okRes.status).toBe(200);

    deleteStrategyMock.mockResolvedValue('not_found');
    const nfRes = makeRes();
    await handler(makeReq('DELETE', '/s/api/directions/ghost', cookie), nfRes as never);
    expect(nfRes.status).toBe(404);
  });

  it('GET /s/api/governance/queue 透传 direction 筛选参数', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/governance/queue?direction=money&status=candidate', cookie), res as never);
    expect(res.status).toBe(200);
    expect(listGovernanceQueueMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      direction: 'money',
      userId: '1',
    }));
  });
});
