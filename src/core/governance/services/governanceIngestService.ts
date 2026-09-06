/**
 * 治理摄取管线：feed 抓取到的候选文章在落库前过一遍治理。
 *
 * 流程（概念移植自三省六部 scheduler.ts，v2 加入归一化与方向分类）：
 *   URL 精确去重（先剥追踪参数；含 7 天驳回记忆）
 *   → 标题归一化（NFKC/全半角/表情）+ bigram ≥ 0.78 相似去重（含 7 天驳回记忆 + 本批次内互查）
 *   → 排除关键词（governance_preferences.exclude_keywords）
 *   → AI 拟折（失败回退，不阻塞）
 *   → 方向分类（策略模板关键词 DSL，未命中归兜底 general；AI 分类是 P2c）
 *   → 配额分桶（每类 daily_limit / focusRatio，今日已占用配额计入）
 *   → 定状态（autoApproveThreshold 达标直接 archived，否则 candidate）
 *
 * 被跳过的条目不落库——RSS 源下次刷新会重新投递，配额重置后仍有机会入库，
 * 与蓝本"配额外不收录"的语义一致。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { isDuplicateTitle, matchExcludeKeyword } from '@/core/governance/dedup';
import { normalizeUrl } from '@/core/governance/normalize';
import {
  DIRECTION_AI_CONFIDENCE_THRESHOLD,
  FALLBACK_DIRECTION_KEY,
  classifyByKeywords,
  computeDirectionAlgoVersion,
  listDirectionStrategies,
} from '@/core/governance/directions';
import {
  draftGovernanceArticle,
  type GovernanceDraft,
} from '@/core/governance/aiDraft';
import { selectQuotaItems, shouldAutoApprove } from '@/core/governance/quota';
import {
  allocateDirectionQuotas,
  selectWithDirectionQuotas,
  splitQuota,
} from '@/core/governance/quota';
import {
  countTodayGovernedByCategory,
  getGovernancePreference,
  listExistingArticleLinks,
  listRecentArticleTitles,
  listRecentRejectMemory,
} from '@/core/governance/repository';
import {
  DEFAULT_DAILY_LIMIT,
  DEFAULT_FOCUS_RATIO,
} from '@/core/governance/quota';
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
  /** 方向分类结果（insert 决策必有值；关键词命中或兜底 general）。 */
  directionKey?: string;
  directionReason?: string;
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

  // 去重数据：一次取齐，逐条内存判断。URL 先剥追踪参数再比对（v2 归一化）。
  const links = input.items.map((item) => item.link).filter((link): link is string => Boolean(link));
  const [existingLinks, rejectMemory, recentTitles, strategies] = await Promise.all([
    listExistingArticleLinks(db, links, scopedUserId),
    listRecentRejectMemory(db, { userId: scopedUserId }),
    listRecentArticleTitles(db, { userId: scopedUserId }),
    listDirectionStrategies(db, { userId: scopedUserId, enabledOnly: true }),
  ]);
  const knownLinks = new Set([
    ...existingLinks,
    ...rejectMemory.map((row) => row.sourceUrl).filter((url): url is string => Boolean(url)),
  ].map(normalizeUrl));
  const knownTitles = [...recentTitles, ...rejectMemory.map((row) => row.title)];

  const draftFn = deps?.draft ?? draftGovernanceArticle;
  // P2c：算法版本快照（模板增删/权重/规则变化都会改变版本），记入 direction_reason 前缀。
  const algoVersion = computeDirectionAlgoVersion(strategies);
  const promptDirections = strategies.map((s) => ({ key: s.key, name: s.name, aiHint: s.aiHint }));
  const enabledDirectionKeys = new Set(strategies.map((s) => s.key));
  const decisions: GovernanceIngestDecision[] = [];
  const scored: Array<{ decision: GovernanceIngestDecision; qualityScore: number }> = [];
  const batchTitles: string[] = [];

  for (const [index, item] of input.items.entries()) {
    const decision: GovernanceIngestDecision = { index, item, action: 'skip' };

    if (item.link && knownLinks.has(normalizeUrl(item.link))) {
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
        directions: promptDirections,
      },
      input.aiConfig,
    );
    batchTitles.push(item.title);

    // ③ 方向分类（双通道）：关键词命中优先；未命中走 AI 分类
    // （幻觉 key / 置信度 < 0.6 / 未配置 / 回退 → 兜底 general）。
    const keywordClassified = classifyByKeywords(item.title, item.summary ?? '', strategies);
    const aiDirectionKey =
      draft.directionKey && enabledDirectionKeys.has(draft.directionKey) ? draft.directionKey : null;
    const aiConfidence = draft.directionConfidence ?? 0;
    const aiClassified =
      !keywordClassified && aiDirectionKey && aiConfidence >= DIRECTION_AI_CONFIDENCE_THRESHOLD
        ? { directionKey: aiDirectionKey, confidence: aiConfidence, reason: draft.directionReason }
        : null;

    let directionKey: string;
    let directionReason: string;
    if (keywordClassified) {
      directionKey = keywordClassified.directionKey;
      const strategyName =
        strategies.find((s) => s.key === keywordClassified.directionKey)?.name ??
        keywordClassified.directionKey;
      directionReason = `命中关键词「${keywordClassified.matchedKeyword ?? ''}」，归入「${strategyName}」`;
    } else if (aiClassified) {
      directionKey = aiClassified.directionKey;
      const strategyName =
        strategies.find((s) => s.key === aiClassified.directionKey)?.name ?? aiClassified.directionKey;
      directionReason =
        `AI 分类（置信度 ${aiClassified.confidence.toFixed(2)}），归入「${strategyName}」` +
        (aiClassified.reason ? `：${aiClassified.reason}` : '');
    } else {
      directionKey = FALLBACK_DIRECTION_KEY;
      directionReason = '关键词未命中且 AI 未给出可信方向，归入「其他」';
    }

    const accepted: GovernanceIngestDecision = {
      index,
      item,
      action: 'insert',
      status: 'candidate',
      draft,
      directionKey,
      directionReason: `[algo ${algoVersion}] ${directionReason}`,
    };
    scored.push({ decision: accepted, qualityScore: draft.qualityScore });
    decisions.push(accepted);
  }

  // ⑤ 配额：今日已占用计入。
  //   无方向模板（理论上 lazy seed 后不会发生）→ 退回 v1 聚焦/常驻桶行为；
  //   有模板 → 第一层分类桶（focusRatio，per-feed 摄取常驻桶恒为空），
  //   第二层桶内按方向 quota_weight 归一化分配（权重 0 的 general 不分配，
  //   但 qualityScore ≥ autoApproveThreshold 时被动收纳直通归档）。
  const todayCount = await countTodayGovernedByCategory(db, {
    categoryId: input.categoryId,
    userId: scopedUserId,
  });
  const remaining = Math.max(0, dailyLimit - todayCount);

  const weights = strategies.map((s) => ({ key: s.key, quotaWeight: s.quotaWeight }));
  const weightByKey = new Map(weights.map((w) => [w.key, w.quotaWeight]));

  // 被动收纳：权重 0 方向的高分候选不占用配额，直接归档。
  const directArchivedSet = new Set<number>();
  if (autoApproveThreshold > 0 && strategies.length > 0) {
    for (const entry of scored) {
      const weight = weightByKey.get(entry.decision.directionKey ?? '') ?? 0;
      if (weight === 0 && shouldAutoApprove(entry.qualityScore, autoApproveThreshold)) {
        directArchivedSet.add(entry.decision.index);
      }
    }
  }
  const quotaPool = scored.filter((entry) => !directArchivedSet.has(entry.decision.index));

  let selectedSet: Set<number>;
  if (remaining <= 0) {
    selectedSet = new Set();
  } else if (strategies.length === 0) {
    // 旧路径：聚焦/常驻桶（无方向概念）。
    const selected = selectQuotaItems({
      focusItems: quotaPool,
      residentItems: [],
      dailyLimit: remaining,
      focusRatio,
    });
    selectedSet = new Set(selected.map((entry) => entry.decision.index));
  } else {
    // 第一层：分类桶（focusRatio）；第二层：聚焦桶内按方向权重分配。
    const { focusQuota } = splitQuota(remaining, focusRatio);
    const directionQuotas = allocateDirectionQuotas(weights, focusQuota);
    const withDirection = quotaPool.map((entry) => ({
      ...entry,
      directionKey: entry.decision.directionKey ?? null,
    }));
    const selected = selectWithDirectionQuotas({
      items: withDirection,
      quotas: directionQuotas,
      weights,
      total: focusQuota,
    });
    // 桶级回填：常驻桶为空，其余量回填聚焦桶内有权重方向的剩余候选。
    let slotsLeft = remaining - selected.length;
    if (slotsLeft > 0) {
      const chosen = new Set(selected);
      const refill = withDirection
        .filter(
          (entry) =>
            !chosen.has(entry) &&
            entry.directionKey !== null &&
            (weightByKey.get(entry.directionKey) ?? 0) > 0,
        )
        .sort((a, b) => b.qualityScore - a.qualityScore);
      selected.push(...refill.slice(0, slotsLeft));
      slotsLeft = remaining - selected.length;
    }
    selectedSet = new Set(selected.map((entry) => entry.decision.index));
  }

  return decisions.map((decision) => {
    if (decision.action !== 'insert') return decision;
    const score = decision.draft?.qualityScore ?? 0;
    // 被动收纳直通：权重 0 方向 + 高分 → archived，不占配额。
    if (directArchivedSet.has(decision.index)) {
      return {
        ...decision,
        status: 'archived' as const,
        draft: decision.draft
          ? {
              ...decision.draft,
              aiReason: `${decision.draft.aiReason}（兜底方向高分直通：质量分 ${score} ≥ 自动准奏阈值 ${autoApproveThreshold}）`,
            }
          : decision.draft,
      };
    }
    if (!selectedSet.has(decision.index)) {
      return {
        index: decision.index,
        item: decision.item,
        action: 'skip',
        skipReason: 'quota_exceeded',
        skipDetail: `分类今日配额 ${dailyLimit} 已用完（今日已收 ${todayCount}）`,
        // 保留方向判定结果便于观测（配额外跳过不等于未分类）。
        directionKey: decision.directionKey,
        directionReason: decision.directionReason,
      };
    }
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
