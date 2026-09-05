import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '@/server/infra/http/errors';

const pool = { connect: vi.fn(), query: vi.fn() };
const requireApiSessionMock = vi.fn();
const createRewriteJobsMock = vi.fn();
const retryPipelineJobMock = vi.fn();
const listPipelineJobsMock = vi.fn();
const listDraftsMock = vi.fn();
const getDraftDetailMock = vi.fn();
const acceptDraftMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({ getPool: () => pool }));
vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));
vi.mock('@/server/domains/pipelines/services/pipelineService', () => ({
  createRewriteJobs: (...args: unknown[]) => createRewriteJobsMock(...args),
  retryPipelineJob: (...args: unknown[]) => retryPipelineJobMock(...args),
}));
vi.mock('@/server/domains/pipelines/repository', () => ({
  listPipelineJobs: (...args: unknown[]) => listPipelineJobsMock(...args),
  listDrafts: (...args: unknown[]) => listDraftsMock(...args),
  getDraftDetail: (...args: unknown[]) => getDraftDetailMock(...args),
  acceptDraft: (...args: unknown[]) => acceptDraftMock(...args),
}));

import { POST as rewritePOST } from '@/app/api/pipelines/rewrite/route';
import { GET as jobsGET } from '@/app/api/pipelines/jobs/route';
import { POST as retryPOST } from '@/app/api/pipelines/jobs/[id]/retry/route';
import { GET as draftsGET } from '@/app/api/drafts/route';
import { GET as draftGET } from '@/app/api/drafts/[id]/route';
import { POST as acceptPOST } from '@/app/api/drafts/[id]/accept/route';
import { GET as exportGET } from '@/app/api/drafts/[id]/export/route';

const SESSION = { userId: '42', role: 'member' as const, sessionVersion: 1 };
const UNAUTHORIZED = {
  response: new Response(JSON.stringify({ ok: false }), { status: 401 }),
};

function postJson(body: unknown) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const DRAFT_DETAIL = {
  id: '9',
  userId: '42',
  articleId: '11',
  jobId: '5',
  platform: 'wechat',
  title: '成稿标题',
  body: '成稿正文',
  similarityScore: 0.28,
  originalityFlag: 'ok',
  status: 'draft',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  articleTitle: '原标题',
  articleSummary: '原摘要',
  articleLink: 'https://example.com/a',
};

describe('/api/pipelines 与 /api/drafts 鉴权', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset().mockResolvedValue(UNAUTHORIZED);
  });

  it('未登录时所有端点直接返回 401', async () => {
    const responses = [
      await rewritePOST(postJson({ articleId: '11', platforms: ['wechat'] })),
      await jobsGET(new Request('http://localhost/api/pipelines/jobs')),
      await retryPOST(new Request('http://localhost', { method: 'POST' }), params('5')),
      await draftsGET(new Request('http://localhost/api/drafts')),
      await draftGET(new Request('http://localhost'), params('9')),
      await acceptPOST(new Request('http://localhost', { method: 'POST' }), params('9')),
      await exportGET(new Request('http://localhost'), params('9')),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
    }
    expect(createRewriteJobsMock).not.toHaveBeenCalled();
    expect(listDraftsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/pipelines/rewrite', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset().mockResolvedValue(SESSION);
    createRewriteJobsMock.mockReset();
  });

  it('成功：为每个平台建 job 并返回', async () => {
    createRewriteJobsMock.mockResolvedValue([
      { job: { id: '5', articleId: '11', kind: 'rewrite', platform: 'wechat', status: 'queued', createdAt: '2026-01-01' }, reused: false, enqueued: true, queueJobId: 'q1' },
      { job: { id: '6', articleId: '11', kind: 'rewrite', platform: 'xhs', status: 'queued', createdAt: '2026-01-01' }, reused: true, enqueued: false, queueJobId: null },
    ]);
    const res = await rewritePOST(postJson({ articleId: '11', platforms: ['wechat', 'xhs'] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.jobs).toHaveLength(2);
    expect(body.data.jobs[0]).toMatchObject({ id: '5', platform: 'wechat', enqueued: true });
    expect(body.data.jobs[1]).toMatchObject({ reused: true, enqueued: false });
    expect(createRewriteJobsMock).toHaveBeenCalledWith(pool, {
      articleId: '11',
      platforms: ['wechat', 'xhs'],
      userId: '42',
    });
  });

  it('platforms 为空或含非法平台 → 400', async () => {
    expect((await rewritePOST(postJson({ articleId: '11', platforms: [] }))).status).toBe(400);
    expect((await rewritePOST(postJson({ articleId: '11', platforms: ['douyin'] }))).status).toBe(400);
    expect(createRewriteJobsMock).not.toHaveBeenCalled();
  });

  it('articleId 非法 → 400', async () => {
    expect((await rewritePOST(postJson({ articleId: 'abc', platforms: ['wechat'] }))).status).toBe(400);
  });

  it('文章不存在 → 404；非 archived（candidate）→ 409', async () => {
    createRewriteJobsMock.mockRejectedValue(new NotFoundError('选题文章不存在'));
    expect((await rewritePOST(postJson({ articleId: '11', platforms: ['wechat'] }))).status).toBe(404);

    createRewriteJobsMock.mockRejectedValue(
      new ConflictError('只有已归档（archived）的选题能进流水线，当前状态：candidate'),
    );
    const res = await rewritePOST(postJson({ articleId: '11', platforms: ['wechat'] }));
    expect(res.status).toBe(409);
  });
});

describe('GET /api/pipelines/jobs 与 retry', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset().mockResolvedValue(SESSION);
    listPipelineJobsMock.mockReset().mockResolvedValue({ items: [], total: 0 });
    retryPipelineJobMock.mockReset();
  });

  it('按 kind/status 过滤并分页，按用户隔离', async () => {
    const res = await jobsGET(new Request('http://localhost/api/pipelines/jobs?kind=rewrite&status=failed&page=2'));
    expect(res.status).toBe(200);
    expect(listPipelineJobsMock).toHaveBeenCalledWith(pool, {
      userId: '42',
      kind: 'rewrite',
      status: 'failed',
      page: 2,
      pageSize: 20,
    });
  });

  it('非法 kind/status → 400', async () => {
    expect((await jobsGET(new Request('http://localhost/api/pipelines/jobs?kind=bogus'))).status).toBe(400);
    expect((await jobsGET(new Request('http://localhost/api/pipelines/jobs?status=bogus'))).status).toBe(400);
  });

  it('retry：成功重新入队；非 failed → 409', async () => {
    retryPipelineJobMock.mockResolvedValue({ job: { id: '5', status: 'queued' }, queueJobId: 'q2' });
    const res = await retryPOST(new Request('http://localhost', { method: 'POST' }), params('5'));
    expect(res.status).toBe(200);
    expect(retryPipelineJobMock).toHaveBeenCalledWith(pool, { id: '5', userId: '42' });

    retryPipelineJobMock.mockRejectedValue(new ConflictError('只有 failed 状态的任务可以重试'));
    expect((await retryPOST(new Request('http://localhost', { method: 'POST' }), params('5'))).status).toBe(409);
  });
});

describe('/api/drafts', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset().mockResolvedValue(SESSION);
    listDraftsMock.mockReset().mockResolvedValue({ items: [], total: 0 });
    getDraftDetailMock.mockReset();
    acceptDraftMock.mockReset();
  });

  it('列表按 articleId/platform 过滤', async () => {
    const res = await draftsGET(new Request('http://localhost/api/drafts?articleId=11&platform=xhs'));
    expect(res.status).toBe(200);
    expect(listDraftsMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      userId: '42',
      articleId: '11',
      platform: 'xhs',
    }));
  });

  it('详情含原文对照；不存在 → 404', async () => {
    getDraftDetailMock.mockResolvedValue(DRAFT_DETAIL);
    const res = await draftGET(new Request('http://localhost'), params('9'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.draft).toMatchObject({
      title: '成稿标题',
      articleTitle: '原标题',
      articleSummary: '原摘要',
      articleLink: 'https://example.com/a',
      similarityScore: 0.28,
      originalityFlag: 'ok',
    });
    expect(getDraftDetailMock).toHaveBeenCalledWith(pool, '9', '42');

    getDraftDetailMock.mockResolvedValue(null);
    expect((await draftGET(new Request('http://localhost'), params('9'))).status).toBe(404);
  });

  it('accept：draft→accepted；状态不允许 → 409；不存在 → 404', async () => {
    acceptDraftMock.mockResolvedValue({ ...DRAFT_DETAIL, status: 'accepted' });
    const res = await acceptPOST(new Request('http://localhost', { method: 'POST' }), params('9'));
    expect(res.status).toBe(200);
    expect(acceptDraftMock).toHaveBeenCalledWith(pool, '9', '42');

    acceptDraftMock.mockResolvedValue(null);
    getDraftDetailMock.mockResolvedValue({ ...DRAFT_DETAIL, status: 'exported' });
    expect((await acceptPOST(new Request('http://localhost', { method: 'POST' }), params('9'))).status).toBe(409);

    getDraftDetailMock.mockResolvedValue(null);
    expect((await acceptPOST(new Request('http://localhost', { method: 'POST' }), params('9'))).status).toBe(404);
  });

  it('export：返回 markdown 下载，frontmatter 带 title/platform/原文链接/相似度', async () => {
    getDraftDetailMock.mockResolvedValue(DRAFT_DETAIL);
    const res = await exportGET(new Request('http://localhost'), params('9'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('draft-9.md');
    const text = await res.text();
    expect(text).toContain('title: "成稿标题"');
    expect(text).toContain('platform: "wechat"');
    expect(text).toContain('original_url: "https://example.com/a"');
    expect(text).toContain('similarity_score: 0.28');
    expect(text).toContain('# 成稿标题');
    expect(text).toContain('成稿正文');
  });
});
