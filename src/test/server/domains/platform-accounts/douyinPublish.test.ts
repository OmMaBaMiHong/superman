import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { ConflictError } from '@/server/infra/http/errors';
import { publishDraftToDouyin } from '@/core/platform-accounts/douyin/douyinPublishService';
import type { SauConfig } from '@/core/platform-accounts/douyin/douyinProvider';

const CONFIG: SauConfig = { baseUrl: 'http://127.0.0.1:5409', token: 'test-token' };

const getDraftDetailMock = vi.fn();
const getPlatformAccountMock = vi.fn();
const insertPublishedPostMock = vi.fn();

vi.mock('@/core/pipelines/repository', () => ({
  getDraftDetail: (...args: unknown[]) => getDraftDetailMock(...args),
}));
vi.mock('@/core/publish-tracking/repository', () => ({
  insertPublishedPost: (...args: unknown[]) => insertPublishedPostMock(...args),
}));
vi.mock('@/core/platform-accounts/repository', () => ({
  getPlatformAccount: (...args: unknown[]) => getPlatformAccountMock(...args),
}));

const pool = {} as Pool;

const DRAFT = {
  id: '9', userId: '42', articleId: '11', jobId: '5', platform: 'douyin',
  title: '视频草稿标题', body: '正文', similarityScore: 0.2, originalityFlag: 'ok',
  status: 'accepted', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  articleTitle: '原标题', articleSummary: '原摘要', articleLink: null,
};

const ACCOUNT = {
  id: '3', userId: '42', platform: 'douyin', accountName: '主号', credKind: 'cookie',
  credentialMasked: '{"c****}', status: 'active', expiresAt: null, lastVerifiedAt: null,
  metaJson: { vendorUserName: 'sess-1', vendorFilePath: 'a.json' },
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('douyin publishService / publishDraftToDouyin', () => {
  beforeEach(() => {
    getDraftDetailMock.mockReset().mockResolvedValue(DRAFT);
    getPlatformAccountMock.mockReset().mockResolvedValue(ACCOUNT);
    insertPublishedPostMock.mockReset().mockResolvedValue({ id: 'p1' });
  });

  it('vendor 侧已有文件名：直接 postVideo，参数组装正确并登记 published_posts', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetcher = vi.fn(async (url: unknown, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
      return new Response(JSON.stringify({ code: 200, msg: 'ok', data: null }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await publishDraftToDouyin(pool, {
      draftId: '9',
      accountId: '3',
      videoPath: 'uuid-abc_成品视频.mp4',
      tags: ['AI', '教程', '', '  '],
      userId: '42',
    }, { config: CONFIG, fetcher });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/postVideo');
    expect(JSON.parse(calls[0].body!)).toMatchObject({
      fileList: ['uuid-abc_成品视频.mp4'],
      accountList: ['sess-1'],
      type: 3,
      title: '视频草稿标题',
      tags: ['AI', '教程'],
      enableTimer: false,
    });
    expect(result.publishedPostId).toBe('p1');
    expect(insertPublishedPostMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      draftId: '9',
      platform: 'douyin',
      postUrl: 'douyin-video://uuid-abc_成品视频.mp4',
    }));
  });

  it('本机绝对路径：先读文件经 /upload 上送再 postVideo', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      if (String(url).includes('/upload')) {
        return new Response(JSON.stringify({ code: 200, data: 'uuid-9_成品.mp4' }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 200, msg: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;
    const readFileFn = vi.fn(async () => Buffer.from('fake-video-bytes'));

    const result = await publishDraftToDouyin(pool, {
      draftId: '9',
      accountId: '3',
      videoPath: '/tmp/成品.mp4',
      userId: '42',
    }, { config: CONFIG, fetcher, readFileFn });

    expect(calls[0]).toContain('/upload');
    expect(calls[1]).toContain('/postVideo');
    expect(result.vendorFilename).toBe('uuid-9_成品.mp4');
  });

  it('videoUrl：下载 → 上送 → 发布；postUrl 用真实 URL', async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'https://cdn.example.com/v.mp4') {
        return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
      }
      if (u.includes('/upload')) {
        return new Response(JSON.stringify({ code: 200, data: 'uuid-7_v.mp4' }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 200, msg: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await publishDraftToDouyin(pool, {
      draftId: '9',
      accountId: '3',
      videoUrl: 'https://cdn.example.com/v.mp4',
      userId: '42',
    }, { config: CONFIG, fetcher });
    expect(result.vendorFilename).toBe('uuid-7_v.mp4');
    expect(result.postUrl).toBe('https://cdn.example.com/v.mp4');
  });

  it('缺视频来源 → 400；非 accepted → 409；账号缺对账 → 409；vendor 报错 → 409', async () => {
    await expect(publishDraftToDouyin(pool, { draftId: '9', accountId: '3', userId: '42' }, { config: CONFIG }))
      .rejects.toMatchObject({ code: 'validation_error' });

    getDraftDetailMock.mockResolvedValue({ ...DRAFT, status: 'draft' });
    await expect(publishDraftToDouyin(pool, { draftId: '9', accountId: '3', videoPath: 'a.mp4', userId: '42' }, { config: CONFIG }))
      .rejects.toBeInstanceOf(ConflictError);

    getDraftDetailMock.mockResolvedValue(DRAFT);
    getPlatformAccountMock.mockResolvedValue({ ...ACCOUNT, metaJson: null });
    await expect(publishDraftToDouyin(pool, { draftId: '9', accountId: '3', videoPath: 'a.mp4', userId: '42' }, { config: CONFIG }))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('对账') });

    getPlatformAccountMock.mockResolvedValue(ACCOUNT);
    const failing = vi.fn(async () => new Response(JSON.stringify({ code: 500, msg: '发布失败: cookie 失效' }), { status: 500 })) as unknown as typeof fetch;
    await expect(publishDraftToDouyin(pool, { draftId: '9', accountId: '3', videoPath: 'a.mp4', userId: '42' }, { config: CONFIG, fetcher: failing }))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('cookie 失效') });
  });
});
