import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AppError } from '@/server/infra/http/errors';
import {
  SAU_PLATFORM_TYPE,
  sauPlatformFromType,
  startSauLoginSession,
  resetSauLoginSessionsForTest,
  type SauConfig,
} from '@/core/platform-accounts/sau/sauProvider';
import { handleSauLoginCallback } from '@/core/platform-accounts/sau/sauService';
import {
  assertXhsPublishAllowed,
  publishDraftVideoToSau,
  XHS_DAILY_PUBLISH_LIMIT,
  XHS_MIN_PUBLISH_INTERVAL_SECONDS,
} from '@/core/platform-accounts/sau/sauPublishService';

const CONFIG: SauConfig = { baseUrl: 'http://127.0.0.1:5409', token: 't' };

const collectMock = vi.fn();
vi.mock('@/core/platform-accounts/repository', () => ({
  createPlatformAccount: (...args: unknown[]) => collectMock(...args),
  findPlatformAccountByName: vi.fn(async () => null),
  updatePlatformAccountCredential: vi.fn(),
  getPlatformAccount: (...args: unknown[]) => getAccountMock(...args),
  updatePlatformAccountMeta: (...args: unknown[]) => updateMetaMock(...args),
  deletePlatformAccount: vi.fn(),
  listPlatformAccounts: vi.fn(),
  markAccountVerified: vi.fn(),
}));
const getAccountMock = vi.fn();
const updateMetaMock = vi.fn();

const getDraftDetailMock = vi.fn();
vi.mock('@/core/pipelines/repository', () => ({
  getDraftDetail: (...args: unknown[]) => getDraftDetailMock(...args),
}));
const insertPublishedPostMock = vi.fn();
vi.mock('@/core/publish-tracking/repository', () => ({
  insertPublishedPost: (...args: unknown[]) => insertPublishedPostMock(...args),
}));

const pool = {} as Pool;

function sseResponse(frames: string[]): Response {
  const text = frames.map((frame) => `data: ${frame}\n\n`).join('');
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }), { status: 200 });
}

describe('sau 泛化 / 平台映射与双平台分支', () => {
  beforeEach(() => {
    resetSauLoginSessionsForTest();
    collectMock.mockReset().mockResolvedValue({ id: 'acc-xhs' });
  });

  it('平台代号双向映射', () => {
    expect(SAU_PLATFORM_TYPE).toEqual({ xhs: 1, douyin: 3 });
    expect(sauPlatformFromType(1)).toBe('xhs');
    expect(sauPlatformFromType(3)).toBe('douyin');
    expect(sauPlatformFromType(2)).toBeNull();
    expect(sauPlatformFromType(4)).toBeNull();
  });

  it('小红书登录会话走 type=1', async () => {
    const fetcher = vi.fn(async () => sseResponse(['200'])) as unknown as typeof fetch;
    const session = startSauLoginSession({
      platform: 'xhs',
      userId: '42',
      accountName: '小红书主号',
      deps: { config: CONFIG, fetcher, uuid: () => 'sess-xhs' },
    });
    expect(session.platform).toBe('xhs');
    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('/login?type=1&id=sess-xhs');
  });

  it('回调按 type 区分平台落库；type 与会话平台不匹配 → 400；不支持 type → 400', async () => {
    startSauLoginSession({
      platform: 'xhs',
      userId: '42',
      accountName: '小红书主号',
      deps: { config: CONFIG, fetcher: vi.fn(async () => sseResponse(['200'])) as unknown as typeof fetch, uuid: () => 'sess-xhs' },
    });
    const result = await handleSauLoginCallback(pool, {
      type: 1, userName: 'sess-xhs', filePath: 'x.json', storageState: { cookies: [] },
    });
    expect(result.platform).toBe('xhs');
    expect(collectMock).toHaveBeenCalledWith(pool, expect.objectContaining({ platform: 'xhs' }));

    // 会话是 xhs，回调 type=3（douyin）→ 平台不匹配
    await expect(handleSauLoginCallback(pool, {
      type: 3, userName: 'sess-xhs', filePath: 'x.json', storageState: {},
    })).rejects.toMatchObject({ code: 'validation_error' });

    // type=2（视频号，本期不支持）→ 400
    await expect(handleSauLoginCallback(pool, {
      type: 2, userName: 'sess-xhs', filePath: 'x.json', storageState: {},
    })).rejects.toMatchObject({ code: 'validation_error' });
  });
});

describe('xhs 发布限频（风控红线）', () => {
  const NOW = new Date('2026-09-06T12:00:00Z').getTime();

  it('间隔 <30 分钟 → 429 带 retryAfterSeconds；恰好 30 分钟 → 放行', () => {
    const recent = { lastPublishAt: new Date(NOW - 600_000).toISOString() }; // 10 分钟前
    try {
      assertXhsPublishAllowed(recent, NOW);
      expect.unreachable('应抛 429');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(429);
      expect((err as AppError).code).toBe('rate_limited');
      expect(Number((err as AppError).fields?.retryAfterSeconds)).toBe(XHS_MIN_PUBLISH_INTERVAL_SECONDS - 600);
    }

    expect(() => assertXhsPublishAllowed(
      { lastPublishAt: new Date(NOW - XHS_MIN_PUBLISH_INTERVAL_SECONDS * 1000).toISOString() },
      NOW,
    )).not.toThrow();
    expect(() => assertXhsPublishAllowed(null, NOW)).not.toThrow();
  });

  it('当日已满 5 条 → 429；跨天计数重置', () => {
    const full = {
      publishCountDate: '2026-09-06',
      publishCountToday: XHS_DAILY_PUBLISH_LIMIT,
    };
    expect(() => assertXhsPublishAllowed(full, NOW)).toThrow(/每日最多发布/);
    // 昨天的计数不拦
    expect(() => assertXhsPublishAllowed(
      { publishCountDate: '2026-09-05', publishCountToday: 99 },
      NOW,
    )).not.toThrow();
  });

  it('发布链路：xhs 走 type=1，成功后 meta 计数 +1，登记 published_posts；限频拦截不发请求', async () => {
    getDraftDetailMock.mockReset().mockResolvedValue({
      id: '9', articleId: '11', title: '视频笔记', body: '正文', status: 'accepted',
      articleSummary: null, articleLink: null,
    });
    updateMetaMock.mockReset().mockResolvedValue(undefined);
    insertPublishedPostMock.mockReset().mockResolvedValue({ id: 'p1' });

    const postVideoCalls: string[] = [];
    const fetcher = vi.fn(async (url: unknown, init?: { body?: string }) => {
      postVideoCalls.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ code: 200, msg: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;

    // ① 限频拦截：10 分钟前刚发过 → 429，不调执行器
    getAccountMock.mockResolvedValue({
      id: '3', platform: 'xhs', credKind: 'cookie', accountName: '小红书主号', status: 'active',
      metaJson: { vendorUserName: 'sess-x', lastPublishAt: new Date(NOW - 600_000).toISOString() },
    });
    await expect(publishDraftVideoToSau(pool, {
      platform: 'xhs', draftId: '9', accountId: '3', videoPath: 'v.mp4', userId: '42',
    }, { config: CONFIG, fetcher, now: () => NOW })).rejects.toMatchObject({ status: 429 });
    expect(postVideoCalls).toHaveLength(0);

    // ② 放行：meta 计数 +1（同日累加），postVideo type=1，published_posts platform=xhs
    getAccountMock.mockResolvedValue({
      id: '3', platform: 'xhs', credKind: 'cookie', accountName: '小红书主号', status: 'active',
      metaJson: { vendorUserName: 'sess-x', publishCountDate: '2026-09-06', publishCountToday: 2 },
    });
    const result = await publishDraftVideoToSau(pool, {
      platform: 'xhs', draftId: '9', accountId: '3', videoPath: 'v.mp4', userId: '42',
    }, { config: CONFIG, fetcher, now: () => NOW });
    expect(result.publishedPostId).toBe('p1');
    const body = JSON.parse(postVideoCalls[0]);
    expect(body).toMatchObject({ type: 1, accountList: ['sess-x'], fileList: ['v.mp4'] });
    expect(updateMetaMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      id: '3',
      metaJson: expect.objectContaining({
        publishCountDate: '2026-09-06',
        publishCountToday: 3,
        lastPublishAt: new Date(NOW).toISOString(),
      }),
    }));
    expect(insertPublishedPostMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      platform: 'xhs',
    }));

    // ③ 抖音不走限频（meta 有近期记录也不拦、不更新计数）
    getAccountMock.mockResolvedValue({
      id: '4', platform: 'douyin', credKind: 'cookie', accountName: '抖音主号', status: 'active',
      metaJson: { vendorUserName: 'sess-d', lastPublishAt: new Date(NOW - 60_000).toISOString() },
    });
    updateMetaMock.mockClear();
    await publishDraftVideoToSau(pool, {
      platform: 'douyin', draftId: '9', accountId: '4', videoPath: 'v.mp4', userId: '42',
    }, { config: CONFIG, fetcher, now: () => NOW });
    expect(updateMetaMock).not.toHaveBeenCalled();
  });
});
