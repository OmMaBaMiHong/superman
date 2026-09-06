import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '@/server/infra/http/errors';
import { publishDraftToWechat } from '@/core/platform-accounts/wechat/publishService';

const getDraftDetailMock = vi.fn();
const getPlatformAccountMock = vi.fn();
const getDecryptedCredentialMock = vi.fn();
const insertPublishedPostMock = vi.fn();

vi.mock('@/core/pipelines/repository', () => ({
  getDraftDetail: (...args: unknown[]) => getDraftDetailMock(...args),
}));
vi.mock('@/core/publish-tracking/repository', () => ({
  insertPublishedPost: (...args: unknown[]) => insertPublishedPostMock(...args),
}));
vi.mock('@/core/platform-accounts/repository', () => ({
  getPlatformAccount: (...args: unknown[]) => getPlatformAccountMock(...args),
  getDecryptedCredential: (...args: unknown[]) => getDecryptedCredentialMock(...args),
}));

const pool = {} as Pool;

const DRAFT = {
  id: '9',
  userId: '42',
  articleId: '11',
  jobId: '5',
  platform: 'wechat',
  title: '成稿标题',
  body: '## 小标题\n\n正文',
  similarityScore: 0.2,
  originalityFlag: 'ok',
  status: 'accepted',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  articleTitle: '原标题',
  articleSummary: '原摘要',
  articleLink: 'https://example.com/a',
};

const ACCOUNT = {
  id: '3',
  userId: '42',
  platform: 'wechat',
  accountName: '主号',
  credKind: 'app_secret',
  credentialMasked: '{"a****}',
  status: 'active',
  expiresAt: null,
  lastVerifiedAt: null,
  metaJson: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('wechat publishService / publishDraftToWechat', () => {
  beforeEach(() => {
    getDraftDetailMock.mockReset().mockResolvedValue(DRAFT);
    getPlatformAccountMock.mockReset().mockResolvedValue(ACCOUNT);
    getDecryptedCredentialMock.mockReset().mockResolvedValue({
      view: ACCOUNT,
      credentialPlaintext: '{"appid":"wx1","secret":"s1"}',
    });
    insertPublishedPostMock.mockReset().mockResolvedValue({ id: 'p1' });
  });

  it('成功：建草稿 → published_posts 自动登记（draft_id 关联）', async () => {
    const addDraft = vi.fn(async () => 'MEDIA_1');
    const result = await publishDraftToWechat(
      pool,
      { draftId: '9', accountId: '3', userId: '42' },
      { mpClientFactory: () => ({ addDraft }) as never },
    );
    expect(result).toEqual({
      mediaId: 'MEDIA_1',
      publishedPostId: 'p1',
      postUrl: 'wechat-mp-draft://media/MEDIA_1',
    });
    const article = addDraft.mock.calls[0][1];
    expect(article.title).toBe('成稿标题');
    expect(article.content).toContain('<section');
    expect(article.contentSourceUrl).toBe('https://example.com/a');
    expect(insertPublishedPostMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      draftId: '9',
      articleId: '11',
      platform: 'wechat',
      postUrl: 'wechat-mp-draft://media/MEDIA_1',
      userId: '42',
    }));
  });

  it('非 accepted 草稿 → 409；草稿不存在 → 404', async () => {
    getDraftDetailMock.mockResolvedValue({ ...DRAFT, status: 'draft' });
    await expect(
      publishDraftToWechat(pool, { draftId: '9', accountId: '3', userId: '42' }),
    ).rejects.toBeInstanceOf(ConflictError);

    getDraftDetailMock.mockResolvedValue(null);
    await expect(
      publishDraftToWechat(pool, { draftId: '9', accountId: '3', userId: '42' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('账号平台/类型不匹配 → 400', async () => {
    getPlatformAccountMock.mockResolvedValue({ ...ACCOUNT, platform: 'douyin', credKind: 'cookie' });
    await expect(
      publishDraftToWechat(pool, { draftId: '9', accountId: '3', userId: '42' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('mp 报错 → 409，错误消息不含 secret', async () => {
    const { WechatMpError } = await import('@/core/platform-accounts/wechat/mpClient');
    const addDraft = vi.fn(async () => {
      throw new WechatMpError({ code: 'token_failed', message: '公众号凭证校验失败：invalid appid', errcode: 40013 });
    });
    await expect(
      publishDraftToWechat(pool, { draftId: '9', accountId: '3', userId: '42' },
        { mpClientFactory: () => ({ addDraft }) as never }),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: expect.not.stringContaining('s1'),
    });
  });
});
