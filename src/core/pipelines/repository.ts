import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';

type DbClient = Pool | PoolClient;

export type PipelineJobKind = 'rewrite' | 'voiceover' | 'video';
export type PipelineJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type DraftStatus = 'draft' | 'accepted' | 'exported';

export interface PipelineJobRow {
  id: string;
  userId: string;
  articleId: string;
  kind: PipelineJobKind;
  platform: string;
  status: PipelineJobStatus;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

const pipelineJobSelectSql = `
  id,
  user_id::text as "userId",
  article_id as "articleId",
  kind,
  platform,
  status,
  input_json as "inputJson",
  output_json as "outputJson",
  error,
  attempts,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

// ============================================================
// 选题文章读取（进流水线的前置校验）
// ============================================================

export interface PipelineArticleRow {
  id: string;
  title: string;
  summary: string | null;
  link: string | null;
  contentHtml: string | null;
  contentFullHtml: string | null;
  governanceStatus: string;
}

export async function getPipelineArticle(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<PipelineArticleRow | null> {
  const { rows } = await db.query<PipelineArticleRow>(
    `
      select
        id,
        title,
        summary,
        link,
        content_html as "contentHtml",
        content_full_html as "contentFullHtml",
        governance_status as "governanceStatus"
      from articles
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

// ============================================================
// pipeline_jobs
// ============================================================

/** 同文章同平台同 kind 的活跃（queued/running）任务，幂等复用。 */
export async function findActivePipelineJob(
  db: DbClient,
  input: { articleId: string; kind: PipelineJobKind; platform: string; userId?: string },
): Promise<PipelineJobRow | null> {
  const { rows } = await db.query<PipelineJobRow>(
    `
      select ${pipelineJobSelectSql}
      from pipeline_jobs
      where user_id = $1
        and article_id = $2
        and kind = $3
        and platform = $4
        and status in ('queued', 'running')
      order by id desc
      limit 1
    `,
    [normalizeUserId(input.userId), input.articleId, input.kind, input.platform],
  );
  return rows[0] ?? null;
}

/**
 * 创建任务。活跃任务已存在时直接返回它（reused=true），不重复建。
 * 依赖 idx_pipeline_jobs_active 部分唯一索引兜底并发。
 */
export async function createPipelineJobIfAbsent(
  db: DbClient,
  input: {
    articleId: string;
    kind: PipelineJobKind;
    platform: string;
    inputJson?: Record<string, unknown>;
    userId?: string;
  },
): Promise<{ job: PipelineJobRow; reused: boolean }> {
  const scopedUserId = normalizeUserId(input.userId);
  const existing = await findActivePipelineJob(db, { ...input, userId: scopedUserId });
  if (existing) return { job: existing, reused: true };

  const { rows } = await db.query<PipelineJobRow>(
    `
      insert into pipeline_jobs(user_id, article_id, kind, platform, input_json)
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (user_id, article_id, kind, platform)
        where status in ('queued', 'running')
      do nothing
      returning ${pipelineJobSelectSql}
    `,
    [scopedUserId, input.articleId, input.kind, input.platform, JSON.stringify(input.inputJson ?? {})],
  );
  if (rows[0]) return { job: rows[0], reused: false };

  // 并发下另一个请求抢先插入：回读活跃任务。
  const raced = await findActivePipelineJob(db, { ...input, userId: scopedUserId });
  if (raced) return { job: raced, reused: true };
  throw new Error('pipeline_job 创建失败');
}

export async function getPipelineJob(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<PipelineJobRow | null> {
  const { rows } = await db.query<PipelineJobRow>(
    `
      select ${pipelineJobSelectSql}
      from pipeline_jobs
      where id = $1
        and user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

export interface PipelineJobListRow extends PipelineJobRow {
  articleTitle: string;
  /** 最近一次执行的耗时（updated_at - created_at），毫秒。 */
  durationMs: number;
}

export async function listPipelineJobs(
  db: DbClient,
  input: {
    kind?: PipelineJobKind;
    status?: PipelineJobStatus;
    page?: number;
    pageSize?: number;
    userId?: string;
  },
): Promise<{ items: PipelineJobListRow[]; total: number }> {
  const scopedUserId = normalizeUserId(input.userId);
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.round(input.pageSize ?? 20)));

  const conditions = ['j.user_id = $1'];
  const values: Array<string | number> = [scopedUserId];
  let paramIndex = 2;
  if (input.kind) {
    conditions.push(`j.kind = $${paramIndex++}`);
    values.push(input.kind);
  }
  if (input.status) {
    conditions.push(`j.status = $${paramIndex++}`);
    values.push(input.status);
  }
  const whereSql = conditions.join(' and ');

  const { rows: countRows } = await db.query<{ count: number }>(
    `select count(*)::int as count from pipeline_jobs j where ${whereSql}`,
    values,
  );

  const { rows } = await db.query(
    `
      select
        j.id,
        j.user_id::text as "userId",
        j.article_id as "articleId",
        j.kind,
        j.platform,
        j.status,
        j.input_json as "inputJson",
        j.output_json as "outputJson",
        j.error,
        j.attempts,
        j.created_at as "createdAt",
        j.updated_at as "updatedAt",
        a.title as "articleTitle",
        (extract(epoch from (j.updated_at - j.created_at)) * 1000)::int as "durationMs"
      from pipeline_jobs j
      join articles a on a.id = j.article_id and a.user_id = j.user_id
      where ${whereSql}
      order by j.created_at desc, j.id desc
      limit $${paramIndex++} offset $${paramIndex++}
    `,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { items: rows as PipelineJobListRow[], total: countRows[0]?.count ?? 0 };
}

export async function markPipelineJobRunning(db: DbClient, id: string): Promise<void> {
  await db.query(
    `
      update pipeline_jobs
      set status = 'running', attempts = attempts + 1, error = null, updated_at = now()
      where id = $1
    `,
    [id],
  );
}

export async function markPipelineJobSucceeded(
  db: DbClient,
  id: string,
  outputJson: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `
      update pipeline_jobs
      set status = 'succeeded', output_json = $2::jsonb, error = null, updated_at = now()
      where id = $1
    `,
    [id, JSON.stringify(outputJson)],
  );
}

export async function markPipelineJobFailed(db: DbClient, id: string, error: string): Promise<void> {
  await db.query(
    `
      update pipeline_jobs
      set status = 'failed', error = $2, updated_at = now()
      where id = $1
    `,
    [id, error.slice(0, 2000)],
  );
}

/** 仅 failed 可重试：置回 queued 并清空错误。 */
export async function requeuePipelineJob(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<PipelineJobRow | null> {
  const { rows } = await db.query<PipelineJobRow>(
    `
      update pipeline_jobs
      set status = 'queued', error = null, updated_at = now()
      where id = $1
        and user_id = $2
        and status = 'failed'
      returning ${pipelineJobSelectSql}
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

// ============================================================
// drafts
// ============================================================

export interface DraftRow {
  id: string;
  userId: string;
  articleId: string;
  jobId: string | null;
  platform: string;
  title: string;
  body: string;
  similarityScore: number | null;
  originalityFlag: 'ok' | 'rewritten' | 'needs_review';
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
}

const draftSelectSql = `
  id,
  user_id::text as "userId",
  article_id as "articleId",
  job_id as "jobId",
  platform,
  title,
  body,
  similarity_score::float as "similarityScore",
  originality_flag as "originalityFlag",
  status,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

export async function insertDraft(
  db: DbClient,
  input: {
    articleId: string;
    jobId: string | null;
    platform: string;
    title: string;
    body: string;
    similarityScore: number | null;
    originalityFlag: 'ok' | 'rewritten' | 'needs_review';
    userId?: string;
  },
): Promise<DraftRow> {
  const { rows } = await db.query<DraftRow>(
    `
      insert into drafts(
        user_id, article_id, job_id, platform, title, body, similarity_score, originality_flag
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning ${draftSelectSql}
    `,
    [
      normalizeUserId(input.userId),
      input.articleId,
      input.jobId,
      input.platform,
      input.title,
      input.body,
      input.similarityScore,
      input.originalityFlag,
    ],
  );
  return rows[0];
}

export interface DraftListRow extends Omit<DraftRow, 'body'> {
  articleTitle: string;
}

export async function listDrafts(
  db: DbClient,
  input: {
    articleId?: string;
    platform?: string;
    page?: number;
    pageSize?: number;
    userId?: string;
  },
): Promise<{ items: DraftListRow[]; total: number }> {
  const scopedUserId = normalizeUserId(input.userId);
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.round(input.pageSize ?? 20)));

  const conditions = ['d.user_id = $1'];
  const values: Array<string | number> = [scopedUserId];
  let paramIndex = 2;
  if (input.articleId) {
    conditions.push(`d.article_id = $${paramIndex++}`);
    values.push(input.articleId);
  }
  if (input.platform) {
    conditions.push(`d.platform = $${paramIndex++}`);
    values.push(input.platform);
  }
  const whereSql = conditions.join(' and ');

  const { rows: countRows } = await db.query<{ count: number }>(
    `select count(*)::int as count from drafts d where ${whereSql}`,
    values,
  );

  const { rows } = await db.query(
    `
      select
        d.id,
        d.user_id::text as "userId",
        d.article_id as "articleId",
        d.job_id as "jobId",
        d.platform,
        d.title,
        d.similarity_score::float as "similarityScore",
        d.originality_flag as "originalityFlag",
        d.status,
        d.created_at as "createdAt",
        d.updated_at as "updatedAt",
        a.title as "articleTitle"
      from drafts d
      join articles a on a.id = d.article_id and a.user_id = d.user_id
      where ${whereSql}
      order by d.created_at desc, d.id desc
      limit $${paramIndex++} offset $${paramIndex++}
    `,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { items: rows as DraftListRow[], total: countRows[0]?.count ?? 0 };
}

export interface DraftDetailRow extends DraftRow {
  articleTitle: string;
  articleSummary: string | null;
  articleLink: string | null;
}

/** 草稿详情：含原文对照（原标题 / 原摘要 / 原链接）。 */
export async function getDraftDetail(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<DraftDetailRow | null> {
  const { rows } = await db.query(
    `
      select
        d.id,
        d.user_id::text as "userId",
        d.article_id as "articleId",
        d.job_id as "jobId",
        d.platform,
        d.title,
        d.body,
        d.similarity_score::float as "similarityScore",
        d.originality_flag as "originalityFlag",
        d.status,
        d.created_at as "createdAt",
        d.updated_at as "updatedAt",
        a.title as "articleTitle",
        a.summary as "articleSummary",
        a.link as "articleLink"
      from drafts d
      join articles a on a.id = d.article_id and a.user_id = d.user_id
      where d.id = $1
        and d.user_id = $2
      limit 1
    `,
    [id, normalizeUserId(userId)],
  );
  return (rows[0] as DraftDetailRow) ?? null;
}

/** 确认草稿：draft/accepted → accepted。 */
export async function acceptDraft(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<DraftRow | null> {
  const { rows } = await db.query<DraftRow>(
    `
      update drafts
      set status = 'accepted', updated_at = now()
      where id = $1
        and user_id = $2
        and status in ('draft', 'accepted')
      returning ${draftSelectSql}
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}
