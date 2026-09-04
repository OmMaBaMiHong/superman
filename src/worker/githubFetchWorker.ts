import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { syncSingleRepo } from '@/server/domains/github/services/githubIngestService';
import { getGithubToken } from '@/server/domains/github/services/githubTokenService';

/**
 * 单仓库同步 worker handler。
 *
 * 解析 Token（失败则回退匿名配额）后委托 `githubIngestService` 完成拉取/映射/落库。
 * 同步内部错误已被 ingest 服务归一化落库，不会抛出；只有非 GitHub 语义异常会上抛，
 * 交由 pg-boss 退避重试 / 进入死信队列。
 */
export async function runGithubFetchWorker(input: {
  pool: Pool;
  boss: Pick<PgBoss, 'send'>;
  data: { userId?: string | null; feedId: string; force?: boolean };
}): Promise<void> {
  const userId = input.data.userId ?? undefined;
  const token = await getGithubToken(input.pool, userId).catch(() => null);

  await syncSingleRepo({
    pool: input.pool,
    feedId: input.data.feedId,
    userId,
    force: input.data.force ?? false,
    token,
  });
}
