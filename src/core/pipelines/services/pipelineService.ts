/**
 * 洗稿流水线的 API 侧编排：归档校验 → 幂等建 job → 入队 / 重试。
 */
import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '@/server/infra/http/errors';
import { getQueueSendOptions } from '@/server/infra/queue/contracts';
import { JOB_PIPELINE_REWRITE } from '@/server/infra/queue/jobs';
import { enqueueWithResult } from '@/server/infra/queue/queue';
import type { RewritePlatform } from '@/core/pipelines/rewriteProfiles';
import {
  createPipelineJobIfAbsent,
  getPipelineArticle,
  requeuePipelineJob,
  type PipelineJobRow,
} from '@/core/pipelines/repository';

type DbClient = Pool | PoolClient;

export interface CreatedRewriteJob {
  job: PipelineJobRow;
  /** true 表示复用了进行中的任务，没有重复创建。 */
  reused: boolean;
  enqueued: boolean;
  queueJobId: string | null;
}

async function enqueueRewrite(job: PipelineJobRow): Promise<{ enqueued: boolean; queueJobId: string | null }> {
  const payload = { jobId: job.id, userId: job.userId };
  const result = await enqueueWithResult(
    JOB_PIPELINE_REWRITE,
    payload,
    getQueueSendOptions(JOB_PIPELINE_REWRITE, { userId: job.userId, jobId: job.id }),
  );
  return {
    enqueued: result.status === 'enqueued',
    queueJobId: result.status === 'enqueued' ? result.jobId : null,
  };
}

/**
 * 为一篇归档选题创建洗稿任务（每平台一个）。
 * 只有 governance_status='archived' 的文章能进流水线；
 * 同 article+platform 已有 queued/running 任务时复用，不重复建、不重复入队。
 */
export async function createRewriteJobs(
  db: DbClient,
  input: { articleId: string; platforms: RewritePlatform[]; userId?: string },
): Promise<CreatedRewriteJob[]> {
  const article = await getPipelineArticle(db, input.articleId, input.userId);
  if (!article) throw new NotFoundError('选题文章不存在');
  if (article.governanceStatus !== 'archived') {
    throw new ConflictError(
      `只有已归档（archived）的选题能进流水线，当前状态：${article.governanceStatus}`,
      { governanceStatus: article.governanceStatus },
    );
  }

  const results: CreatedRewriteJob[] = [];
  for (const platform of input.platforms) {
    const { job, reused } = await createPipelineJobIfAbsent(db, {
      userId: input.userId,
      articleId: input.articleId,
      kind: 'rewrite',
      platform,
      inputJson: { articleTitle: article.title },
    });
    const enqueueResult = reused
      ? { enqueued: false, queueJobId: null }
      : await enqueueRewrite(job);
    results.push({ job, reused, ...enqueueResult });
  }
  return results;
}

/** 重试失败任务：置回 queued 并重新入队。 */
export async function retryPipelineJob(
  db: DbClient,
  input: { id: string; userId?: string },
): Promise<{ job: PipelineJobRow; queueJobId: string | null }> {
  const job = await requeuePipelineJob(db, input.id, input.userId);
  if (!job) {
    throw new ConflictError('只有 failed 状态的任务可以重试（或任务不存在）');
  }
  const { queueJobId } = await enqueueRewrite(job);
  return { job, queueJobId };
}
