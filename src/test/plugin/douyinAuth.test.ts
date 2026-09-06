import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

const startSessionMock = vi.fn();
const getSessionMock = vi.fn();
const confirmSessionMock = vi.fn();
const handleCallbackMock = vi.fn();
const verifyDouyinMock = vi.fn();
const publishDouyinMock = vi.fn();
const markVerifiedMock = vi.fn();
const getAccountMock = vi.fn();

vi.mock('@/core/platform-accounts/douyin/douyinProvider', () => ({
  startDouyinLoginSession: (...args: unknown[]) => startSessionMock(...args),
  getDouyinLoginSession: (...args: unknown[]) => getSessionMock(...args),
}));
vi.mock('@/core/platform-accounts/douyin/douyinService', () => ({
  confirmDouyinLoginSession: (...args: unknown[]) => confirmSessionMock(...args),
  handleDouyinLoginCallback: (...args: unknown[]) => handleCallbackMock(...args),
  verifyDouyinAccount: (...args: unknown[]) => verifyDouyinMock(...args),
}));
vi.mock('@/core/platform-accounts/douyin/douyinPublishService', () => ({
  publishDraftToDouyin: (...args: unknown[]) => publishDouyinMock(...args),
}));
vi.mock('@/core/platform-accounts/repository', () => ({
  listPlatformAccounts: vi.fn(async () => []),
  createPlatformAccount: vi.fn(),
  getPlatformAccount: (...args: unknown[]) => getAccountMock(...args),
  deletePlatformAccount: vi.fn(),
  markAccountVerified: (...args: unknown[]) => markVerifiedMock(...args),
}));
vi.mock('@/core/platform-accounts/wechat/publishService', () => ({
  publishDraftToWechat: vi.fn(),
  verifyWechatAccount: vi.fn(),
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
vi.mock('@/core/publish-tracking/repository', () => ({
  listPublishedPostsWithMetrics: vi.fn(async () => []),
  getPublishedPost: vi.fn(async () => null),
  listSnapshotsSince: vi.fn(async () => []),
  setPublishedPostTracking: vi.fn(),
  deletePublishedPost: vi.fn(),
}));
vi.mock('@/core/publish-tracking/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/publish-tracking/service')>();
  return { ...original, registerPublishedPost: vi.fn(), refreshPublishedPost: vi.fn() };
});

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

function makeReq(method: string, url: string, cookie?: string, payload?: unknown, headers?: Record<string, string>) {
  const mergedHeaders = { ...(cookie ? { cookie } : {}), ...(headers ?? {}) };
  if (method === 'POST' || method === 'PUT') {
    const req = Readable.from([Buffer.from(JSON.stringify(payload ?? {}))]) as Readable & {
      method: string; url: string; headers: Record<string, string>;
    };
    req.method = method;
    req.url = url;
    req.headers = mergedHeaders;
    return req as never;
  }
  const req = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> };
  req.method = method;
  req.url = url;
  req.headers = mergedHeaders;
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

describe('plugin/host/api · 抖音扫码授权流（P2e-2）', () => {
  beforeEach(() => {
    startSessionMock.mockReset();
    getSessionMock.mockReset();
    confirmSessionMock.mockReset();
    handleCallbackMock.mockReset();
    delete process.env.SAU_TOKEN;
  });

  it('创建扫码会话 → 轮询二维码状态 → confirm 落库', async () => {
    startSessionMock.mockReturnValue({ id: 'sess-1' });
    getSessionMock.mockReturnValue({
      id: 'sess-1', userId: '1', status: 'pending', qrSrc: 'https://douyin.example/qr.png',
    });
    confirmSessionMock.mockResolvedValue({ id: 'acc-1', platform: 'douyin' });

    const { auth, handler } = makeHandler();
    const cookie = await login(auth);

    const create = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/douyin/login-session', cookie, { accountName: '主号' }), create as never);
    expect(create.status).toBe(200);
    expect(JSON.parse(create.body).data.sessionId).toBe('sess-1');
    expect(startSessionMock).toHaveBeenCalledWith({ userId: '1', accountName: '主号' });

    const qr = makeRes();
    await handler(makeReq('GET', '/s/api/platform-accounts/douyin/login-session/sess-1/qr', cookie), qr as never);
    expect(qr.status).toBe(200);
    expect(JSON.parse(qr.body).data).toEqual({ status: 'pending', qrSrc: 'https://douyin.example/qr.png' });

    const confirm = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/douyin/login-session/sess-1/confirm', cookie, {}), confirm as never);
    expect(confirm.status).toBe(200);
    expect(confirmSessionMock).toHaveBeenCalledWith(fakeDb, { sessionId: 'sess-1', userId: '1' });

    // 别人的会话 → 404
    getSessionMock.mockReturnValue({ id: 'sess-1', userId: '7', status: 'pending', qrSrc: null });
    const foreign = makeRes();
    await handler(makeReq('GET', '/s/api/platform-accounts/douyin/login-session/sess-1/qr', cookie), foreign as never);
    expect(foreign.status).toBe(404);
  });

  it('缺 accountName → 400；未登录 → 401', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const bad = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/douyin/login-session', cookie, {}), bad as never);
    expect(bad.status).toBe(400);

    const anon = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/douyin/login-session', undefined, { accountName: 'x' }), anon as never);
    expect(anon.status).toBe(401);
  });

  it('回调：SAU_TOKEN 未配置 → 401；错误 token → 401；正确 token → 落库', async () => {
    handleCallbackMock.mockResolvedValue({ accountId: 'acc-1', userId: '1' });
    const { handler } = makeHandler();

    // 未配置 SAU_TOKEN → 拒绝（防裸奔）
    const noEnv = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/douyin/callback', undefined, {
      type: 3, userName: 'sess-1', filePath: 'a.json', storageState: {},
    }, { 'x-sau-token': 'whatever' }), noEnv as never);
    expect(noEnv.status).toBe(401);

    process.env.SAU_TOKEN = 'shared-secret';
    const wrong = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/douyin/callback', undefined, {
      type: 3, userName: 'sess-1', filePath: 'a.json', storageState: {},
    }, { 'x-sau-token': 'nope' }), wrong as never);
    expect(wrong.status).toBe(401);

    const ok = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/douyin/callback', undefined, {
      type: 3, userName: 'sess-1', filePath: 'a.json', storageState: { cookies: [] },
    }, { 'x-sau-token': 'shared-secret' }), ok as never);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).data).toEqual({ accountId: 'acc-1', userId: '1' });
    expect(handleCallbackMock).toHaveBeenCalledWith(fakeDb, {
      type: 3, userName: 'sess-1', filePath: 'a.json', storageState: { cookies: [] },
    });
  });

  it('verify：douyin cookie 账号走真实验证并回写状态', async () => {
    getAccountMock.mockReset().mockResolvedValue({
      id: '3', userId: '1', platform: 'douyin', credKind: 'cookie', status: 'active',
      metaJson: { vendorUserName: 'sess-1' },
    });
    verifyDouyinMock.mockReset().mockResolvedValue({ verified: true });
    markVerifiedMock.mockReset().mockResolvedValue(undefined);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/3/verify', cookie, {}), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.verified).toBe(true);
    expect(markVerifiedMock).toHaveBeenCalledWith(fakeDb, {
      id: '3', ok: true, failStatus: 'expired', userId: '1',
    });
  });

  it('publish：platform=douyin 分支透传 videoPath/tags', async () => {
    publishDouyinMock.mockReset().mockResolvedValue({
      vendorFilename: 'uuid-1_v.mp4', publishedPostId: 'p1', postUrl: 'douyin-video://uuid-1_v.mp4',
    });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/drafts/9/publish', cookie, {
      platform: 'douyin', accountId: '3', videoPath: 'uuid-1_v.mp4', tags: ['AI'],
    }), res as never);
    expect(res.status).toBe(200);
    expect(publishDouyinMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      draftId: '9',
      accountId: '3',
      videoPath: 'uuid-1_v.mp4',
      tags: ['AI'],
      userId: '1',
    }));
  });
});
