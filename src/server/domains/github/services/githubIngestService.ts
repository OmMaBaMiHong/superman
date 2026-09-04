import type { Pool } from 'pg';
import { listReleases } from '@/server/integrations/github/githubClient';
import { renderReleaseBody } from '@/server/integrations/github/githubMarkdown';
import { toReleaseDraft } from '@/server/integrations/github/githubResourceMapper';
import {
  EMPTY_RATE_LIMIT_SNAPSHOT,
  resolveRateLimitedUntil,
  type GithubRateLimitSnapshot,
} from '@/server/integrations/github/githubRateLimit';
import { getFeedById } from '@/server/domains/feeds/repositories/feedsRepo';
import { insertArticleIgnoreDuplicate } from '@/server/domains/articles/repositories/articlesRepo';
import {
  getGithubSubscriptionRow,
  recordGithubRateLimit,
  recordGithubSyncResult,
} from '@/server/domains/github/repositories/githubSubscriptionsRepo';
import { insertGithubArticleItem } from '@/server/domains/github/repositories/githubArticleItemsRepo';
import { computeNextSyncAt } from '@/server/domains/github/tasks/githubBackoff';
import { mapGithubFetchError, type GithubFetchErrorResult } from '@/server/domains/github/tasks/githubFetchErrorMapping';
import { getGithubToken } from '@/server/domains/github/services/githubTokenService';
import { isGithubApiError } from '@/server/integrations/github/githubErrors';
import { NotFoundError } from '@/server/infra/http/errors';
import { normalizeUserId } from '@/server/domains/users/userScope';

export interface SyncSingleRepoInput {
  pool: Pool;
  feedId: string;
  userId?: string;
  /** 跳过 ETag 条件请求，强制重新拉取（手动刷新用）。 */
  force?: boolean;
  /** 直接传入 Token，避免回表读取（worker 内部已解析）。 */
  token?: string | null;
  now?: Date;
}

export interface GithubSyncOutcome {
  inserted: number;
  status: number | null;
  etag: string | null;
  error?: GithubFetchErrorResult;
}

function buildSummary(bodyMarkdown: string | null): string | null {
  if (!bodyMarkdown) return null;
  const cleaned = bodyMarkdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 200 ? `${cleaned.slice(0, 200)}...` : cleaned;
}

/**
 * 单仓库同步核心流程。
 *
 * 取 Token → 拉 Releases → 映射草稿 → 去重落库（articles + github_article_items）
 * → 记录同步结果 / 限流熔断。
 *
 * 错误处置：
 * - `GithubApiError`：归一化后落库，返回 outcome（不抛出，避免 pg-boss 无谓重试）
 * - 其他异常（网络/代码 bug）：原样抛出，交由 pg-boss 退避重试
 */
export async function syncSingleRepo(input: SyncSingleRepoInput): Promise<GithubSyncOutcome> {
  const now = input.now ?? new Date();
  const userId = normalizeUserId(input.userId);

  const subscription = await getGithubSubscriptionRow(input.pool, input.feedId, userId);
  if (!subscription) {
    throw new NotFoundError('GitHub 订阅不存在');
  }

  const feed = await getFeedById(input.pool, input.feedId, userId);
  if (!feed || !feed.enabled) {
    // 订阅被禁用或已删除：当作成功（无事可做）避免重复告警。
    return { inserted: 0, status: null, etag: subscription.releasesEtag };
  }

  // 硬限流熔断：rate_limited_until 仍在未来时直接短路返回，绝不外呼 GitHub。
  // 手动强刷（force:true）仅用于跳过 ETag 复用，绝不能击穿硬限流——否则会直接打爆配额
  // （调度侧全量强刷分支同样受此约束，构成完整防护）。
  if (subscription.rateLimitedUntil && new Date(subscription.rateLimitedUntil).getTime() > now.getTime()) {
    return {
      inserted: 0,
      status: null,
      etag: subscription.releasesEtag,
      error: {
        errorCode: 'rate_limited',
        errorMessage: 'GitHub 请求已达速率上限，稍后将自动恢复',
        rawErrorMessage: null,
      },
    };
  }

  const token = typeof input.token === 'string' ? input.token : await getGithubToken(input.pool, userId);
  const hasToken = Boolean(token && token.trim());

  try {
    const result = await listReleases({
      owner: subscription.owner,
      repo: subscription.repo,
      token,
      etag: input.force ? null : subscription.releasesEtag,
      userId,
    });

    // 命中 304：无新内容，刷新同步时间即可。
    if (result.status === 304) {
      await recordGithubSyncResult(input.pool, {
        feedId: input.feedId,
        userId,
        status: 304,
        etag: subscription.releasesEtag,
        succeeded: true,
        nextSyncAt: computeNextSyncAt({
          intervalMinutes: feed.fetchIntervalMinutes,
          hasToken,
          now,
        }).toISOString(),
        rateLimitRemaining: result.rateLimit.remaining,
      });
      return { inserted: 0, status: 304, etag: subscription.releasesEtag };
    }

    let inserted = 0;
    let latestPublishedAt: string | null = null;

    for (const release of result.releases) {
      if (release.isDraft) continue;
      if (release.isPrerelease && !subscription.includePrerelease) continue;

      const draft = toReleaseDraft(release, {
        renderBody: ({ bodyHtml, bodyMarkdown }) =>
          renderReleaseBody({ bodyHtml, bodyMarkdown, baseUrl: subscription.repoHtmlUrl }),
      });

      const created = await insertArticleIgnoreDuplicate(input.pool, {
        userId,
        feedId: input.feedId,
        dedupeKey: draft.dedupeKey,
        title: draft.title,
        link: draft.htmlUrl,
        author: draft.author,
        publishedAt: draft.publishedAt,
        contentHtml: draft.contentHtml,
        summary: buildSummary(draft.bodyMarkdown),
        sourceLanguage: 'en',
      });

      if (created) {
        inserted += 1;
        await insertGithubArticleItem(input.pool, {
          articleId: created.id,
          userId,
          feedId: input.feedId,
          ghType: 'release',
          ghId: draft.ghId,
          tagName: draft.tagName,
          isPrerelease: draft.isPrerelease,
          isDraft: draft.isDraft,
          bodyMarkdown: draft.bodyMarkdown,
          htmlUrl: draft.htmlUrl,
        });
      }

      if (
        draft.publishedAt &&
        (!latestPublishedAt || new Date(draft.publishedAt).getTime() > new Date(latestPublishedAt).getTime())
      ) {
        latestPublishedAt = draft.publishedAt;
      }
    }

    await recordGithubSyncResult(input.pool, {
      feedId: input.feedId,
      userId,
      status: result.status,
      etag: result.etag,
      lastReleasePublishedAt: latestPublishedAt,
      succeeded: true,
      nextSyncAt: computeNextSyncAt({
        intervalMinutes: feed.fetchIntervalMinutes,
        hasToken,
        now,
      }).toISOString(),
      rateLimitRemaining: result.rateLimit.remaining,
    });

    return { inserted, status: result.status, etag: result.etag };
  } catch (err) {
    if (!isGithubApiError(err)) {
      // 非 GitHub 语义错误（网络抖动 / 代码异常）：上抛，交由 pg-boss 退避重试。
      throw err;
    }

    const mapped = mapGithubFetchError(err);
    const rateLimit: GithubRateLimitSnapshot = err.rateLimit ?? EMPTY_RATE_LIMIT_SNAPSHOT;

    if (err.kind === 'rate_limited') {
      const until = resolveRateLimitedUntil(rateLimit, now).toISOString();
      await recordGithubRateLimit(input.pool, {
        feedId: input.feedId,
        userId,
        rateLimitedUntil: until,
        rateLimitRemaining: rateLimit.remaining,
      });
      await recordGithubSyncResult(input.pool, {
        feedId: input.feedId,
        userId,
        status: err.status,
        succeeded: false,
        nextSyncAt: until,
        errorCode: mapped.errorCode,
        errorMessage: mapped.errorMessage,
        rawErrorMessage: mapped.rawErrorMessage,
        rateLimitRemaining: rateLimit.remaining,
      });
      return { inserted: 0, status: err.status, etag: subscription.releasesEtag, error: mapped };
    }

    const nextSyncAt = computeNextSyncAt({
      intervalMinutes: feed.fetchIntervalMinutes,
      hasToken,
      consecutiveFailures: subscription.consecutiveFailures + 1,
      now,
    }).toISOString();

    await recordGithubSyncResult(input.pool, {
      feedId: input.feedId,
      userId,
      status: err.status,
      succeeded: false,
      nextSyncAt,
      errorCode: mapped.errorCode,
      errorMessage: mapped.errorMessage,
      rawErrorMessage: mapped.rawErrorMessage,
      rateLimitRemaining: rateLimit.remaining,
    });

    return { inserted: 0, status: err.status, etag: subscription.releasesEtag, error: mapped };
  }
}
