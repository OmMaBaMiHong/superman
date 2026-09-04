import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { enqueueWithResult } from '@/server/infra/queue/queue';
import { getQueueSendOptions } from '@/server/infra/queue/contracts';
import { JOB_GITHUB_FETCH_REPO } from '@/server/infra/queue/jobs';
import { getGithubSubscriptionRow } from '@/server/domains/github/repositories/githubSubscriptionsRepo';
import { getFeedById } from '@/server/domains/feeds/repositories/feedsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 手动触发单仓库同步。
 *
 * 走队列而非同步执行：GitHub 拉取可能耗时数秒且受限流影响，
 * 阻塞 HTTP 响应会让 UI 卡死。singletonKey 天然防抖，重复点击返回 already_enqueued。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { id } = await context.params;
    if (!id?.trim()) {
      return fail(new ValidationError('Invalid request', { id: '缺少订阅 id' }));
    }

    const pool = getPool();
    const subscription = await getGithubSubscriptionRow(pool, id, session.userId);
    if (!subscription) {
      return fail(new NotFoundError('GitHub 订阅不存在'));
    }

    const feed = await getFeedById(pool, id, session.userId);
    if (!feed?.enabled) {
      return fail(new ValidationError('Invalid request', { id: '该订阅已停用' }));
    }

    const payload = { userId: session.userId, feedId: id, force: true };
    const result = await enqueueWithResult(
      JOB_GITHUB_FETCH_REPO,
      payload,
      getQueueSendOptions(JOB_GITHUB_FETCH_REPO, { userId: session.userId, feedId: id }),
    );

    if (result.status === 'enqueued') {
      return ok({ enqueued: true, feedId: id });
    }

    // singletonKey 去重：重复点击不堆积任务，显式告知前端原因。
    return ok({ enqueued: false, feedId: id, reason: 'already_enqueued' as const });
  } catch (err) {
    return fail(err);
  }
}
