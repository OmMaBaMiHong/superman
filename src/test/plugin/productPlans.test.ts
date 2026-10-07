import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

const listMock = vi.fn();
const statsMock = vi.fn();
const getMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const manualMock = vi.fn();
const fromArticleMock = vi.fn();
const scanMock = vi.fn();
const runMock = vi.fn();
const resolveAiConfigMock = vi.fn(async () => null);

vi.mock('@/core/product-plans/service', () => ({
  createManualProductPlan: (...args: unknown[]) => manualMock(...args),
  createProductPlanFromArticle: (...args: unknown[]) => fromArticleMock(...args),
  scanProductPlanCandidates: (...args: unknown[]) => scanMock(...args),
  runProductPlanPipeline: (...args: unknown[]) => runMock(...args),
  resolveProductPlanAiConfig: (...args: unknown[]) => resolveAiConfigMock(...args),
}));
vi.mock('@/core/product-plans/repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/product-plans/repository')>();
  return {
    ...original,
    listProductPlans: (...args: unknown[]) => listMock(...args),
    getProductPlanStats: (...args: unknown[]) => statsMock(...args),
    getProductPlan: (...args: unknown[]) => getMock(...args),
    updateProductPlan: (...args: unknown[]) => updateMock(...args),
    deleteProductPlan: (...args: unknown[]) => deleteMock(...args),
  };
});

// 插件 api.ts 顶层还 import 了这些模块，mock 掉避免真实副作用。
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
  getAppSettings: vi.fn(async () => ({})),
}));
vi.mock('@/core/notify/repository', () => ({
  listNotifications: vi.fn(async () => ({ items: [], total: 0 })),
  countUnreadNotifications: vi.fn(async () => 0),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('@/core/notify/service', () => ({ notify: vi.fn(), notifyOncePerWindow: vi.fn() }));
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

const PLAN = {
  id: '3', userId: '1', title: '口播助手', oneLiner: '一键转口播稿',
  productDesc: '核心功能', targetUsers: '自媒体人', approach: '先做 MVP',
  businessModel: '订阅制', risks: '同质化', competitors: '某工具', pricing: '19 元/月',
  milestones: '3 个月上线', validationPlan: '找 20 个博主试用',
  status: 'idea', sourceType: 'manual', sourceArticleId: null, sourceUrl: null,
  sourceNote: '我的点子', aiGenerated: true, createdAt: '2026-09-19', updatedAt: '2026-09-19',
};

describe('plugin/host/api · 产品计划路由', () => {
  it('未登录返回 401', async () => {
    const { handler } = makeHandler();
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/product-plans'), res as never);
    expect(res.status).toBe(401);
  });

  it('GET /product-plans 透传过滤参数', async () => {
    listMock.mockReset().mockResolvedValue({ items: [PLAN], total: 1 });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/product-plans?status=idea&source=manual&limit=10', cookie), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.total).toBe(1);
    expect(listMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      userId: '1', status: 'idea', sourceType: 'manual', limit: 10,
    }));

    const bad = makeRes();
    await handler(makeReq('GET', '/s/api/product-plans?status=nope', cookie), bad as never);
    expect(bad.status).toBe(400);
  });

  it('GET /product-plans/stats 返回统计', async () => {
    statsMock.mockReset().mockResolvedValue({ total: 3, byStatus: {}, manual: 1, aiInferred: 2 });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/product-plans/stats', cookie), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({ total: 3, aiInferred: 2 });
  });

  it('POST /product-plans 口述想法 → 生成计划；空想法 400', async () => {
    manualMock.mockReset().mockResolvedValue({ plan: PLAN, usedFallback: false });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/product-plans', cookie, { rawIdea: '做一个口播助手' }), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.plan.id).toBe('3');
    expect(manualMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      userId: '1', rawIdea: '做一个口播助手',
    }));

    const bad = makeRes();
    await handler(makeReq('POST', '/s/api/product-plans', cookie, { rawIdea: '   ' }), bad as never);
    expect(bad.status).toBe(400);
  });

  it('POST /product-plans/generate 从文章推理；不存在 404', async () => {
    fromArticleMock.mockReset().mockResolvedValue({ plan: { ...PLAN, sourceType: 'ai_inferred' }, usedFallback: false, alreadyExists: false });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/product-plans/generate', cookie, { articleId: '11' }), res as never);
    expect(res.status).toBe(200);
    expect(fromArticleMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({ userId: '1', articleId: '11' }));

    fromArticleMock.mockResolvedValue(null);
    const nf = makeRes();
    await handler(makeReq('POST', '/s/api/product-plans/generate', cookie, { articleId: '99' }), nf as never);
    expect(nf.status).toBe(404);
  });

  it('POST /product-plans/scan 批量扫描', async () => {
    scanMock.mockReset().mockResolvedValue({ scanned: 5, created: 2, usedFallback: 0 });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/product-plans/scan', cookie, { limit: 5 }), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({ scanned: 5, created: 2 });
  });

  it('POST /product-plans/:id/run 补齐/重跑流水线；不存在 404', async () => {
    runMock.mockReset().mockResolvedValue({
      plan: PLAN,
      pipeline: {
        source: { status: 'done' }, transcript: { status: 'done' },
        analysis: { status: 'done' }, remix: { status: 'done' },
      },
    });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/product-plans/3/run', cookie, { force: true }), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.pipeline.remix.status).toBe('done');
    expect(runMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({ userId: '1', planId: '3', force: true }));

    runMock.mockResolvedValue(null);
    const nf = makeRes();
    await handler(makeReq('POST', '/s/api/product-plans/99/run', cookie, {}), nf as never);
    expect(nf.status).toBe(404);
  });

  it('GET/PUT/DELETE /product-plans/:id', async () => {
    getMock.mockReset().mockResolvedValue(PLAN);
    updateMock.mockReset().mockResolvedValue({ ...PLAN, status: 'validating' });
    deleteMock.mockReset().mockResolvedValue(true);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);

    const get = makeRes();
    await handler(makeReq('GET', '/s/api/product-plans/3', cookie), get as never);
    expect(get.status).toBe(200);
    expect(JSON.parse(get.body).data.plan.id).toBe('3');

    const put = makeRes();
    await handler(makeReq('PUT', '/s/api/product-plans/3', cookie, { status: 'validating', title: '口播助手 v2' }), put as never);
    expect(put.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(fakeDb, '3', expect.objectContaining({ status: 'validating', title: '口播助手 v2' }), '1');

    const badStatus = makeRes();
    await handler(makeReq('PUT', '/s/api/product-plans/3', cookie, { status: 'nope' }), badStatus as never);
    expect(badStatus.status).toBe(400);

    const del = makeRes();
    await handler(makeReq('DELETE', '/s/api/product-plans/3', cookie), del as never);
    expect(del.status).toBe(200);

    deleteMock.mockResolvedValue(false);
    const nf = makeRes();
    await handler(makeReq('DELETE', '/s/api/product-plans/3', cookie), nf as never);
    expect(nf.status).toBe(404);
  });
});
