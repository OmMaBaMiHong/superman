import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { executeRewriteJob } from '@/core/pipelines/services/rewriteService';

const getPipelineJobMock = vi.fn();
const getPipelineArticleMock = vi.fn();
const insertDraftMock = vi.fn();
const markRunningMock = vi.fn();
const markSucceededMock = vi.fn();
const markFailedMock = vi.fn();
const getUiSettingsMock = vi.fn();
const getAiApiKeyMock = vi.fn();

vi.mock('@/core/pipelines/repository', () => ({
  getPipelineJob: (...args: unknown[]) => getPipelineJobMock(...args),
  getPipelineArticle: (...args: unknown[]) => getPipelineArticleMock(...args),
  insertDraft: (...args: unknown[]) => insertDraftMock(...args),
  markPipelineJobRunning: (...args: unknown[]) => markRunningMock(...args),
  markPipelineJobSucceeded: (...args: unknown[]) => markSucceededMock(...args),
  markPipelineJobFailed: (...args: unknown[]) => markFailedMock(...args),
}));
vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: (...args: unknown[]) => getUiSettingsMock(...args),
  getAiApiKey: (...args: unknown[]) => getAiApiKeyMock(...args),
}));

const pool = {} as Pool;

const JOB = {
  id: '5',
  userId: '42',
  articleId: '11',
  kind: 'rewrite',
  platform: 'wechat',
  status: 'queued',
  inputJson: {},
  outputJson: null,
  error: null,
  attempts: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const ARTICLE = {
  id: '11',
  title: '原始标题',
  summary: '原摘要',
  link: 'https://example.com/a',
  contentHtml: '<p>原文正文内容</p>',
  contentFullHtml: null,
  governanceStatus: 'archived',
};

function llmOk(body = '改写成稿正文') {
  return vi.fn(async () => JSON.stringify({ title: '成稿标题', body }));
}

describe('rewriteService / executeRewriteJob', () => {
  beforeEach(() => {
    getPipelineJobMock.mockReset().mockResolvedValue(JOB);
    getPipelineArticleMock.mockReset().mockResolvedValue(ARTICLE);
    insertDraftMock.mockReset().mockResolvedValue({ id: '99' });
    markRunningMock.mockReset().mockResolvedValue(undefined);
    markSucceededMock.mockReset().mockResolvedValue(undefined);
    markFailedMock.mockReset().mockResolvedValue(undefined);
    getUiSettingsMock.mockReset().mockResolvedValue({});
    getAiApiKeyMock.mockReset().mockResolvedValue('');
  });

  it('成功：LLM 改写 → draft 落库 → job succeeded，attempts 流转', async () => {
    const complete = llmOk();
    const similarity = vi.fn(() => 0.2);
    const result = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete, similarity });

    expect(result).toMatchObject({
      status: 'succeeded',
      draftId: '99',
      similarityScore: 0.2,
      originalityFlag: 'ok',
    });
    expect(markRunningMock).toHaveBeenCalledWith(pool, '5');
    expect(insertDraftMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      articleId: '11',
      jobId: '5',
      platform: 'wechat',
      title: '成稿标题',
      originalityFlag: 'ok',
    }));
    expect(markSucceededMock).toHaveBeenCalledWith(pool, '5', expect.objectContaining({
      draftId: '99',
      rewrittenOnce: false,
    }));
    expect(markFailedMock).not.toHaveBeenCalled();
  });

  it('相似度 0.35-0.5：不触发第二轮，标记 rewritten', async () => {
    const complete = llmOk();
    const similarity = vi.fn(() => 0.4);
    const result = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete, similarity });
    expect(result.originalityFlag).toBe('rewritten');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('相似度 > 0.5：自动带降重指令重写一次，复评后落库', async () => {
    const prompts: string[] = [];
    const complete = vi.fn(async (input: { prompt: string }) => {
      prompts.push(input.prompt);
      return JSON.stringify({ title: '成稿标题', body: '成稿' });
    });
    const similarity = vi.fn()
      .mockReturnValueOnce(0.62)  // 第一轮超标
      .mockReturnValueOnce(0.28); // 降重后达标
    const result = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete, similarity });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(prompts[0]).not.toContain('降重要求');
    expect(prompts[1]).toContain('降重要求');
    expect(result.originalityFlag).toBe('ok');
    expect(markSucceededMock).toHaveBeenCalledWith(pool, '5', expect.objectContaining({
      rewrittenOnce: true,
    }));
  });

  it('降重后仍 > 0.5：needs_review 落库（人工终审红线）', async () => {
    const complete = llmOk();
    const similarity = vi.fn(() => 0.7);
    const result = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete, similarity });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.originalityFlag).toBe('needs_review');
    expect(insertDraftMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      originalityFlag: 'needs_review',
    }));
  });

  it('LLM 失败：job 置 failed 带明确 error，不写 draft，不向上抛错', async () => {
    const complete = vi.fn(async () => {
      throw new Error('LLM 超时');
    });
    const result = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('LLM 超时');
    expect(markFailedMock).toHaveBeenCalledWith(pool, '5', expect.stringContaining('LLM 超时'));
    expect(insertDraftMock).not.toHaveBeenCalled();
    expect(markSucceededMock).not.toHaveBeenCalled();
  });

  it('未配置 AI（无注入 complete 且 key 为空）：failed 且说明原因', async () => {
    getAiApiKeyMock.mockResolvedValue('');
    const result = await executeRewriteJob(pool, { jobId: '5', userId: '42' });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('未配置 AI');
  });

  it('任务不存在 / 已成功幂等跳过 / 未知平台', async () => {
    getPipelineJobMock.mockResolvedValue(null);
    expect((await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete: llmOk() })).error)
      .toContain('任务不存在');

    getPipelineJobMock.mockResolvedValue({ ...JOB, status: 'succeeded' });
    const dup = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete: llmOk() });
    expect(dup.status).toBe('succeeded');
    expect(markRunningMock).not.toHaveBeenCalled();

    getPipelineJobMock.mockResolvedValue({ ...JOB, platform: 'douyin' });
    const bad = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete: llmOk() });
    expect(bad.error).toContain('未知的洗稿平台');
  });

  it('原文为空：failed，不调 LLM', async () => {
    getPipelineArticleMock.mockResolvedValue({ ...ARTICLE, contentHtml: null, contentFullHtml: null });
    const complete = llmOk();
    const result = await executeRewriteJob(pool, { jobId: '5', userId: '42' }, { complete });
    expect(result.error).toContain('原文内容为空');
    expect(complete).not.toHaveBeenCalled();
  });
});
