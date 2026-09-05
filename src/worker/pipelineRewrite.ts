/**
 * pg-boss job `pipeline.rewrite`：洗稿流水线执行入口。
 * 业务状态由 pipeline_jobs 自管（queued/running/succeeded/failed + 手动重试），
 * 执行失败不抛给 pg-boss（契约 retryLimit: 0），失败原因写进 job.error。
 */
import { getPool } from '@/server/infra/db/pool';
import { executeRewriteJob } from '@/server/domains/pipelines/services/rewriteService';

export interface PipelineRewriteJobData {
  jobId: string;
  userId?: string;
}

export async function runPipelineRewriteWorker(data: PipelineRewriteJobData): Promise<void> {
  const result = await executeRewriteJob(getPool(), {
    jobId: data.jobId,
    userId: data.userId,
  });
  if (result.status === 'failed') {
    console.warn(`[pipeline.rewrite] job=${data.jobId} failed: ${result.error}`);
    return;
  }
  console.log(
    `[pipeline.rewrite] job=${data.jobId} succeeded draft=${result.draftId} ` +
      `similarity=${result.similarityScore} flag=${result.originalityFlag}`,
  );
}
