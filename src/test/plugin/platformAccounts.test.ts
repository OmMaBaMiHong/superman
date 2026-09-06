import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

const listAccountsMock = vi.fn();
const createAccountMock = vi.fn();
const getAccountMock = vi.fn();
const deleteAccountMock = vi.fn();
const markVerifiedMock = vi.fn();
const publishToWechatMock = vi.fn();
const verifyWechatMock = vi.fn();

vi.mock('@/core/platform-accounts/repository', () => ({
  listPlatformAccounts: (...args: unknown[]) => listAccountsMock(...args),
  createPlatformAccount: (...args: unknown[]) => createAccountMock(...args),
  getPlatformAccount: (...args: unknown[]) => getAccountMock(...args),
  deletePlatformAccount: (...args: unknown[]) => deleteAccountMock(...args),
  markAccountVerified: (...args: unknown[]) => markVerifiedMock(...args),
}));
vi.mock('@/core/platform-accounts/wechat/publishService', () => ({
  publishDraftToWechat: (...args: unknown[]) => publishToWechatMock(...args),
  verifyWechatAccount: (...args: unknown[]) => verifyWechatMock(...args),
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
  return {
    ...original,
    registerPublishedPost: vi.fn(),
    refreshPublishedPost: vi.fn(),
  };
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

const ACCOUNT = {
  id: '3', userId: '1', platform: 'wechat', accountName: '主号', credKind: 'app_secret',
  credentialMasked: '{"a****"}', status: 'active', expiresAt: null, lastVerifiedAt: null,
  metaJson: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('plugin/host/api · 平台授权中心路由（P2e-1）', () => {
  it('未登录返回 401', async () => {
    const { handler } = makeHandler();
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/platform-accounts'), res as never);
    expect(res.status).toBe(401);
  });

  it('GET /platform-accounts 列表不含凭据字段', async () => {
    listAccountsMock.mockReset().mockResolvedValue([ACCOUNT]);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/platform-accounts?platform=wechat', cookie), res as never);
    expect(res.status).toBe(200);
    const item = JSON.parse(res.body).data.items[0];
    expect(item.credentialMasked).toContain('****');
    expect(item).not.toHaveProperty('credentialEncrypted');
    expect(item).not.toHaveProperty('credential');
    expect(listAccountsMock).toHaveBeenCalledWith(fakeDb, { userId: '1', platform: 'wechat' });
  });

  it('POST /platform-accounts 添加账号（app_secret 校验）；重复 409', async () => {
    createAccountMock.mockReset().mockResolvedValue(ACCOUNT);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);

    const res = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts', cookie, {
      platform: 'wechat',
      accountName: '主号',
      credKind: 'app_secret',
      credential: { appid: 'wx1', secret: 's1' },
    }), res as never);
    expect(res.status).toBe(200);
    expect(createAccountMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      platform: 'wechat',
      credKind: 'app_secret',
      credentialPlaintext: '{"appid":"wx1","secret":"s1"}',
      userId: '1',
    }));

    const missing = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts', cookie, {
      platform: 'wechat', credKind: 'app_secret', credential: { appid: 'wx1' },
    }), missing as never);
    expect(missing.status).toBe(400);

    createAccountMock.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const dup = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts', cookie, {
      platform: 'wechat', credKind: 'app_secret', credential: { appid: 'wx1', secret: 's1' },
    }), dup as never);
    expect(dup.status).toBe(409);
  });

  it('verify：成功回写 active；假凭证返回 verified:false 且错误不含明文', async () => {
    getAccountMock.mockReset().mockResolvedValue(ACCOUNT);
    verifyWechatMock.mockReset().mockResolvedValue(undefined);
    markVerifiedMock.mockReset().mockResolvedValue(undefined);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);

    const ok = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/3/verify', cookie, {}), ok as never);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).data.verified).toBe(true);
    expect(markVerifiedMock).toHaveBeenCalledWith(fakeDb, { id: '3', ok: true, userId: '1' });

    const { WechatMpError } = await import('@/core/platform-accounts/wechat/mpClient');
    verifyWechatMock.mockRejectedValue(new WechatMpError({
      code: 'token_failed', message: '公众号凭证校验失败：invalid appid', errcode: 40013,
    }));
    const fail = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/3/verify', cookie, {}), fail as never);
    expect(fail.status).toBe(200);
    const body = JSON.parse(fail.body);
    expect(body.data.verified).toBe(false);
    expect(body.data.reason).toContain('invalid appid');
    expect(markVerifiedMock).toHaveBeenCalledWith(fakeDb, expect.objectContaining({ id: '3', ok: false }));

    // 非 wechat/douyin 平台 → stub（P2e-3）
    getAccountMock.mockResolvedValue({ ...ACCOUNT, platform: 'xhs', credKind: 'cookie' });
    const stub = makeRes();
    await handler(makeReq('POST', '/s/api/platform-accounts/3/verify', cookie, {}), stub as never);
    expect(JSON.parse(stub.body).data.reason).toContain('P2e');
  });

  it('POST /drafts/:id/publish 发到公众号草稿箱', async () => {
    publishToWechatMock.mockReset().mockResolvedValue({
      mediaId: 'MEDIA_1',
      publishedPostId: 'p1',
      postUrl: 'wechat-mp-draft://media/MEDIA_1',
    });
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/drafts/9/publish', cookie, { platform: 'wechat', accountId: '3' }), res as never);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toMatchObject({ mediaId: 'MEDIA_1', publishedPostId: 'p1' });
    expect(publishToWechatMock).toHaveBeenCalledWith(fakeDb, { draftId: '9', accountId: '3', userId: '1' });

    const badPlatform = makeRes();
    await handler(makeReq('POST', '/s/api/drafts/9/publish', cookie, { platform: 'xhs', accountId: '3' }), badPlatform as never);
    expect(badPlatform.status).toBe(400);
  });

  it('DELETE /platform-accounts/:id', async () => {
    deleteAccountMock.mockReset().mockResolvedValue(true);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('DELETE', '/s/api/platform-accounts/3', cookie), res as never);
    expect(res.status).toBe(200);
    deleteAccountMock.mockResolvedValue(false);
    const nf = makeRes();
    await handler(makeReq('DELETE', '/s/api/platform-accounts/3', cookie), nf as never);
    expect(nf.status).toBe(404);
  });
});
