import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

vi.mock('@/core/governance/repository', () => ({
  listGovernanceQueue: vi.fn(async () => ({
    items: [{ id: '11', title: '示例选题', status: 'candidate' }],
    total: 1,
    page: 1,
    pageSize: 20,
  })),
  getGovernanceStats: vi.fn(async () => ({ candidate: 3, pending: 1, archived: 2 })),
  getGovernanceItemDetail: vi.fn(async (_db: unknown, input: { id: string }) =>
    input.id === '11' ? { id: '11', title: '示例选题', contentHtml: '<p>正文</p>' } : null),
}));

vi.mock('@/core/governance/services/governanceActionsService', () => ({
  approveGovernanceItem: vi.fn(async (_db: unknown, input: { id: string }) => ({
    id: input.id,
    status: 'archived',
  })),
  rejectGovernanceItem: vi.fn(async (_db: unknown, input: { id: string; reason: string }) => ({
    id: input.id,
    status: 'rejected',
    reason: input.reason,
  })),
  redraftGovernanceItem: vi.fn(async () => ({ item: { id: '11', status: 'candidate' }, draft: null })),
  restoreGovernanceItem: vi.fn(async (_db: unknown, input: { id: string }) => ({ id: input.id, status: 'candidate' })),
}));

vi.mock('@/core/trendradar/repository', () => ({
  listTrendRadarItemsByDate: vi.fn(async () => [
    { id: '5', platform: 'weibo', platformName: '微博', title: '热搜一', rank: 1, sourceDate: '2026-09-05' },
  ]),
}));

vi.mock('@/core/trendradar/promote', () => ({
  promoteTrendRadarItem: vi.fn(async (_db: unknown, input: { id: string }) =>
    input.id === '5'
      ? { ok: true as const, articleId: '99', alreadyPromoted: false }
      : { ok: false as const }),
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
  // POST 用真实 Readable：data/end 只在使用方开始读时才发出，
  // 避免「监听还没挂上 body 就流完」的竞态。
  if (method === 'POST') {
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

describe('plugin/host/api · 治理路由', () => {
  it('未登录访问业务 API 返回 401 信封', async () => {
    const { handler } = makeHandler();
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/governance/queue'), res as never);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('GET /s/api/governance/queue 登录后返回队列结构', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/governance/queue?status=candidate,pending', cookie), res as never);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ id: '11', status: 'candidate' });
    expect(body.data.total).toBe(1);
  });

  it('非法 status 参数返回 400 validation_error', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/governance/queue?status=bogus', cookie), res as never);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('validation_error');
  });

  it('POST approve 流转：返回归档后的条目', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/governance/items/11/approve', cookie), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.item).toMatchObject({ id: '11', status: 'archived' });
  });

  it('POST reject 带理由；非法条目 ID 返回 400', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/governance/items/11/reject', cookie, { reason: '质量差' }), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.item).toMatchObject({ status: 'rejected', reason: '质量差' });

    const bad = makeRes();
    await handler(makeReq('POST', '/s/api/governance/items/abc/approve', cookie), bad as never);
    expect(bad.status).toBe(400);
  });

  it('GET 条目详情：不存在返回 404 not_found', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/governance/items/404', cookie), res as never);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('not_found');
  });
});

describe('plugin/host/api · 热点路由', () => {
  it('GET /s/api/trend-radar/today 按平台分组返回', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/trend-radar/today?date=2026-09-05', cookie), res as never);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.platforms[0]).toMatchObject({ platform: 'weibo' });
    expect(body.data.platforms[0].items).toHaveLength(1);
  });

  it('POST promote 幂等返回 articleId；不存在返回 404', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/trend-radar/items/5/promote', cookie), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({ articleId: '99', alreadyPromoted: false });

    const missing = makeRes();
    await handler(makeReq('POST', '/s/api/trend-radar/items/999/promote', cookie), missing as never);
    expect(missing.status).toBe(404);
  });
});
