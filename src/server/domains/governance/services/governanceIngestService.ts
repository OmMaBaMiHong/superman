/**
 * 治理摄取管线：feed 抓取到的候选文章在落库前过一遍治理。
 *
 * 流程（概念移植自三省六部 scheduler.ts）：
 *   URL 精确去重（含 7 天驳回记忆）
 *   → 标题 bigram ≥ 0.78 相似去重（含 7 天驳回记忆 + 本批次内互查）
 *   → 排除关键词（governance_preferences.exclude_keywords）
 *   → AI 拟折（失败回退，不阻塞）
 *   → 配额分桶（每类 daily_limit / focusRatio，今日已占用配额计入）
 *   → 定状态（autoApproveThreshold 达标直接 archived，否则 candidate）
 *
 * 被跳过的条目不落库——RSS 源下次刷新会重新投递，配额重置后仍有机会入库，
 * 与蓝本"配额外不收录"的语义一致。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { isDuplicateTitle, matchExcludeKeyword } from '@/server/domains/governance/dedup';
import {
  draftGovernanceArticle,
  type GovernanceDraft,
} from '@/server/domains/governance/aiDraft';
import { selectQuotaItems, shouldAutoApprove } from '@/server/domains/governance/quota';
import {
  countTodayGovernedByCategory,
  getGovernancePreference,
  listExistingArticleLinks,
  listRecentArticleTitles,
  listRecentRejectMemory,
} from '@/server/domains/governance/repository';
import {
  DEFAULT_DAILY_LIMIT,
  DEFAULT_FOCUS_RATIO,
} from '@/server/domains/governance/quota';
import type { AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';

type DbClient = Pool | PoolClient;

export interface GovernanceIngestItem {
  dedupeKey: string;
  title: string;
  link: string | null;
  summary: string | null;
  /** 去 HTML 后的正文纯文本，用于去重与拟折。 */
  contentText: string;
}

export type GovernanceSkipReason =
  | 'duplicate_url'
  | 'duplicate_title'
  | 'excluded_keyword'
  | 'quota_exceeded';

export interface GovernanceIngestDecision {
  index: number;
  item: GovernanceIngestItem;
  action: 'insert' | 'skip';
  skipReason?: GovernanceSkipReason;
  skipDetail?: string;
  status?: 'candidate' | 'archived';
  draft?: GovernanceDraft;
}

export interface GovernanceIngestDeps {
  draft?: typeof draftGovernanceArticle;
}

export async function evaluateGovernanceBatch(
  db: DbClient,
  input: {
    categoryId: string | null;
    feedTitle: string;
    categoryTitle?: string | null;
    items: GovernanceIngestItem[];
    aiConfig: AiRuntimeConfig | null;
    userId?: string;
  },
  deps?: GovernanceIngestDeps,
): Promise<GovernanceIngestDecision[]> {
  const scopedUserId = normalizeUserId(input.userId);
  if (input.items.length === 0) return [];

  const preference = input.categoryId
    ? await getGovernancePreference(db, input.categoryId, scopedUserId)
    : null;
  const dailyLimit = preference?.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  const focusRatio = preference?.focusRatio ?? DEFAULT_FOCUS_RATIO;
  const autoApproveThreshold = preference?.autoApproveThreshold ?? 0;
  const excludeKeywords = preference?.excludeKeywords ?? [];

  // 去重数据：一次取齐，逐条内存判断。
  const links = input.items.map((item) => item.link).filter((link): link is string => Boolean(link));
  const [existingLinks, rejectMemory, recentTitles] = await Promise.all([
    listExistingArticleLinks(db, links, scopedUserId),
    listRecentRejectMemory(db, { userId: scopedUserId }),
    listRecentArticleTitles(db, { userId: scopedUserId }),
  ]);
  const knownLinks = new Set([
    ...existingLinks,
    ...rejectMemory.map((row) => row.sourceUrl).filter((url): url is string => Boolean(url)),
  ]);
  const knownTitles = [...recentTitles, ...rejectMemory.map((row) => row.title)];

  const draftFn = deps?.draft ?? draftGovernanceArticle;
  const decisions: GovernanceIngestDecision[] = [];
  const scored: Array<{ decision: GovernanceIngestDecision; qualityScore: number }> = [];
  const batchTitles: string[] = [];

  for (const [index, item] of input.items.entries()) {
    const decision: GovernanceIngestDecision = { index, item, action: 'skip' };

    if (item.link && knownLinks.has(item.link)) {
      decisions.push({ ...decision, skipReason: 'duplicate_url', skipDetail: item.link });
      continue;
    }
    if (isDuplicateTitle(item.title, [...knownTitles, ...batchTitles])) {
      decisions.push({ ...decision, skipReason: 'duplicate_title', skipDetail: item.title });
      continue;
    }
    const keywordHit = matchExcludeKeyword(
      { title: item.title, summary: item.summary, contentText: item.contentText },
      excludeKeywords,
    );
    if (keywordHit.excluded) {
      decisions.push({
        ...decision,
        skipReason: 'excluded_keyword',
        skipDetail: keywordHit.matchedKeyword ?? undefined,
      });
      continue;
    }

    const draft = await draftFn(
      {
        title: item.title,
        contentText: item.contentText,
        sourceUrl: item.link,
        feedTitle: input.feedTitle,
        categoryTitle: input.categoryTitle ?? null,
      },
      input.aiConfig,
    );
    batchTitles.push(item.title);
    const accepted: GovernanceIngestDecision = {
      index,
      item,
      action: 'insert',
      status: 'candidate',
      draft,
    };
    scored.push({ decision: accepted, qualityScore: draft.qualityScore });
    decisions.push(accepted);
  }

  // 配额：今日已占用计入，剩余配额在聚焦/常驻桶间按质量分截取。
  const todayCount = await countTodayGovernedByCategory(db, {
    categoryId: input.categoryId,
    userId: scopedUserId,
  });
  const remaining = Math.max(0, dailyLimit - todayCount);

  const selected =
    remaining > 0
      ? selectQuotaItems({
          focusItems: scored,
          residentItems: [],
          dailyLimit: remaining,
          focusRatio,
        })
      : [];
  const selectedSet = new Set(selected.map((entry) => entry.decision.index));

  return decisions.map((decision) => {
    if (decision.action !== 'insert') return decision;
    if (!selectedSet.has(decision.index)) {
      return {
        index: decision.index,
        item: decision.item,
        action: 'skip',
        skipReason: 'quota_exceeded',
        skipDetail: `分类今日配额 ${dailyLimit} 已用完（今日已收 ${todayCount}）`,
      };
    }
    const score = decision.draft?.qualityScore ?? 0;
    const autoApproved = shouldAutoApprove(score, autoApproveThreshold);
    return {
      ...decision,
      status: autoApproved ? 'archived' : 'candidate',
      draft: decision.draft && autoApproved
        ? {
            ...decision.draft,
            aiReason: `${decision.draft.aiReason}（质量分 ${score} ≥ 自动准奏阈值 ${autoApproveThreshold}）`,
          }
        : decision.draft,
    };
  });
}
