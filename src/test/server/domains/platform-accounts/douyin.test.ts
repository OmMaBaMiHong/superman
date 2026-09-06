import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import {
  downloadVendorCookie,
  listVendorAccounts,
  resetDouyinLoginSessionsForTest,
  startDouyinLoginSession,
  type SauConfig,
} from '@/core/platform-accounts/douyin/douyinProvider';
import {
  collectDouyinAccount,
  confirmDouyinLoginSession,
  handleDouyinLoginCallback,
  verifyDouyinAccount,
} from '@/core/platform-accounts/douyin/douyinService';

const CONFIG: SauConfig = { baseUrl: 'http://127.0.0.1:5409', token: 'test-token' };

const createAccountMock = vi.fn();
const findByNameMock = vi.fn();
const updateCredentialMock = vi.fn();

vi.mock('@/core/platform-accounts/repository', () => ({
  createPlatformAccount: (...args: unknown[]) => createAccountMock(...args),
  findPlatformAccountByName: (...args: unknown[]) => findByNameMock(...args),
  updatePlatformAccountCredential: (...args: unknown[]) => updateCredentialMock(...args),
  getPlatformAccount: vi.fn(),
  deletePlatformAccount: vi.fn(),
  listPlatformAccounts: vi.fn(),
  markAccountVerified: vi.fn(),
}));

const pool = {} as Pool;

function sseResponse(frames: string[]): Response {
  const text = frames.map((frame) => `data: ${frame}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('douyin provider / 扫码会话状态机', () => {
  beforeEach(() => {
    resetDouyinLoginSessionsForTest();
  });

  it('pending → confirmed（二维码 src → 200）', async () => {
    const fetcher = vi.fn(async () => sseResponse(['https://douyin.example/qr.png', '200'])) as unknown as typeof fetch;
    const session = startDouyinLoginSession({
      userId: '42',
      accountName: '主号',
      deps: { config: CONFIG, fetcher, uuid: () => 'sess-1' },
    });
    expect(session.status).toBe('pending');
    expect(session.vendorUserName).toBe('sess-1');

    await waitFor(() => session.status === 'confirmed');
    expect(session.qrSrc).toBe('https://douyin.example/qr.png');
    // vendor /login 调用带 token 头与账号名
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain('/login?type=3&id=sess-1');
    expect(init.headers['x-sau-token']).toBe('test-token');
  });

  it('pending → expired（500 / 流异常结束）', async () => {
    const fetcher = vi.fn(async () => sseResponse(['500'])) as unknown as typeof fetch;
    const session = startDouyinLoginSession({
      userId: '42',
      accountName: '主号',
      deps: { config: CONFIG, fetcher, uuid: () => 'sess-2' },
    });
    await waitFor(() => session.status === 'expired');

    const failing = vi.fn(async () => { throw new Error('conn refused'); }) as unknown as typeof fetch;
    const session2 = startDouyinLoginSession({
      userId: '42',
      accountName: '主号',
      deps: { config: CONFIG, fetcher: failing, uuid: () => 'sess-3' },
    });
    await waitFor(() => session2.status === 'expired');
  });

  it('listVendorAccounts 只保留 type=3 且解析行结构', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      data: [
        [1, 3, 'uuid-a.json', 'sess-1', 1],
        [2, 1, 'xhs.json', '别的平台', 1],
        [3, 3, 'uuid-b.json', 'sess-2', 0],
      ],
    }), { status: 200 })) as unknown as typeof fetch;
    const rows = await listVendorAccounts(CONFIG, { fetcher });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ filePath: 'uuid-a.json', userName: 'sess-1', status: 1 });
  });

  it('downloadVendorCookie 非 200 返回 null', async () => {
    const ok = vi.fn(async () => new Response('{"cookies":[]}', { status: 200 })) as unknown as typeof fetch;
    expect(await downloadVendorCookie(CONFIG, 'a.json', { fetcher: ok })).toEqual({ cookies: [] });
    const notFound = vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
    expect(await downloadVendorCookie(CONFIG, 'a.json', { fetcher: notFound })).toBeNull();
  });
});

describe('douyin service / cookie 上收', () => {
  beforeEach(() => {
    resetDouyinLoginSessionsForTest();
    createAccountMock.mockReset().mockResolvedValue({ id: 'acc-1', platform: 'douyin' });
    findByNameMock.mockReset().mockResolvedValue(null);
    updateCredentialMock.mockReset().mockResolvedValue({ id: 'acc-1' });
  });

  it('collect：无同名账号新建；有则覆盖凭据（重新授权）', async () => {
    await collectDouyinAccount(pool, {
      userId: '42',
      accountName: '主号',
      vendorUserName: 'sess-1',
      filePath: 'a.json',
      storageState: { cookies: [] },
    });
    expect(createAccountMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      platform: 'douyin',
      credKind: 'cookie',
      credentialPlaintext: '{"cookies":[]}',
      metaJson: { vendorUserName: 'sess-1', vendorFilePath: 'a.json' },
      userId: '42',
    }));

    findByNameMock.mockResolvedValue({ id: 'acc-1' });
    await collectDouyinAccount(pool, {
      userId: '42',
      accountName: '主号',
      vendorUserName: 'sess-1',
      filePath: 'a.json',
      storageState: { cookies: [1] },
    });
    expect(updateCredentialMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      id: 'acc-1',
      credentialPlaintext: '{"cookies":[1]}',
    }));
  });

  it('回调落库：按会话绑用户；未知会话拒绝', async () => {
    startDouyinLoginSession({
      userId: '42',
      accountName: '主号',
      deps: { config: CONFIG, fetcher: vi.fn(async () => sseResponse(['200'])) as unknown as typeof fetch, uuid: () => 'sess-cb' },
    });
    const result = await handleDouyinLoginCallback(pool, {
      type: 3,
      userName: 'sess-cb',
      filePath: 'a.json',
      storageState: { cookies: [] },
    });
    expect(result).toEqual({ accountId: 'acc-1', userId: '42' });
    expect(createAccountMock).toHaveBeenCalledWith(pool, expect.objectContaining({ userId: '42' }));

    await expect(handleDouyinLoginCallback(pool, {
      type: 3, userName: 'ghost', filePath: 'a.json', storageState: {},
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('confirm 拉取兜底：对账 + 下载 cookie + 落库；未 confirmed → 409', async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/getAccounts')) {
        return new Response(JSON.stringify({ code: 200, data: [[1, 3, 'a.json', 'sess-cf', 1]] }), { status: 200 });
      }
      if (u.includes('/downloadCookie')) {
        return new Response('{"cookies":[1]}', { status: 200 });
      }
      return sseResponse(['200']);
    }) as unknown as typeof fetch;

    const session = startDouyinLoginSession({
      userId: '42',
      accountName: '主号',
      deps: { config: CONFIG, fetcher, uuid: () => 'sess-cf' },
    });
    await waitFor(() => session.status === 'confirmed');

    const account = await confirmDouyinLoginSession(pool, { sessionId: 'sess-cf', userId: '42' }, { config: CONFIG, fetcher });
    expect(account.id).toBe('acc-1');
    expect(createAccountMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      credentialPlaintext: '{"cookies":[1]}',
    }));

    // 未 confirmed 的会话 → 409
    startDouyinLoginSession({
      userId: '42',
      accountName: '主号',
      deps: { config: CONFIG, fetcher: vi.fn(async () => new Promise<Response>(() => {})) as unknown as typeof fetch, uuid: () => 'sess-pending' },
    });
    await expect(confirmDouyinLoginSession(pool, { sessionId: 'sess-pending', userId: '42' }, { config: CONFIG, fetcher }))
      .rejects.toBeInstanceOf(ConflictError);
    // 别人的会话 → 404
    await expect(confirmDouyinLoginSession(pool, { sessionId: 'sess-cf', userId: '7' }, { config: CONFIG, fetcher }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('verify：对账记录 status=1 有效；失效/缺对账信息/执行器不可用各有 reason', async () => {
    const base = { id: 'acc-1', platform: 'douyin' as const, credKind: 'cookie' as const, metaJson: { vendorUserName: 'sess-1' } };
    const mkFetcher = (rows: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ code: 200, data: rows }), { status: 200 })) as unknown as typeof fetch;

    expect(await verifyDouyinAccount(base as never, { config: CONFIG, fetcher: mkFetcher([[1, 3, 'a.json', 'sess-1', 1]]) }))
      .toEqual({ verified: true });
    expect(await verifyDouyinAccount(base as never, { config: CONFIG, fetcher: mkFetcher([[1, 3, 'a.json', 'sess-1', 0]]) }))
      .toMatchObject({ verified: false, reason: expect.stringContaining('失效') });
    expect(await verifyDouyinAccount(base as never, { config: CONFIG, fetcher: mkFetcher([]) }))
      .toMatchObject({ verified: false, reason: expect.stringContaining('无此账号') });
    expect(await verifyDouyinAccount({ ...base, metaJson: null } as never, { config: CONFIG }))
      .toMatchObject({ verified: false, reason: expect.stringContaining('vendorUserName') });
    const down = vi.fn(async () => { throw new Error('conn refused'); }) as unknown as typeof fetch;
    expect(await verifyDouyinAccount(base as never, { config: CONFIG, fetcher: down }))
      .toMatchObject({ verified: false, reason: expect.stringContaining('执行器不可用') });
  });
});
