import type { Pool } from 'pg';
import { listDueSubscriptions } from '@/server/domains/github/repositories/githubSubscriptionsRepo';
import { getQueueSendOptions } from '@/server/infra/queue/contracts';
import { JOB_GITHUB_FETCH_REPO } from '@/server/infra/queue/jobs';
import { enqueueWithResult } from '@/server/infra/queue/queue';
import { normalizeUserId } from '@/server/domains/users/userScope';

/**
 * 每分钟 tick：扫描 `next_sync_at <= now()` 的 GitHub 订阅并投递单仓库同步任务。
 *
 * 重复投递由 pg-boss 的 singletonKey（userId:feedId）自然去重，
 * 因此这里不推进 `next_sync_at` —— 真正的退避在同步 worker 落库时计算。
 * 对标 `feverAutoSync.ts`。
 */
export async function runGithubSyncDue(input: {
  pool: Pool;
  now?: Date;
  userId?: string;
}): Promise<{ enqueued: number }> {
  const now = input.now ?? new Date();
  const due = await listDueSubscriptions(input.pool, now, input.userId);
  let enqueued = 0;

  for (const sub of due) {
    const result = await enqueueWithResult(
      JOB_GITHUB_FETCH_REPO,
      { userId: sub.userId, feedId: sub.feedId },
      getQueueSendOptions(JOB_GITHUB_FETCH_REPO, {
        userId: sub.userId,
        feedId: sub.feedId,
      }),
    );
    if (result.status === 'enqueued') {
      enqueued += 1;
    }
  }

  return { enqueued };
}
