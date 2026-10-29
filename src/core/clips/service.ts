/**
 * 剪贴板快速收藏服务。
 *
 * 用户从任意地方复制内容粘贴进 Superman，跳过审批直接入库。
 * 收藏内容固定 80 分，自动方向分类，排在 RSS 文章前面。
 *
 * 流程：
 *   1. 创建 article（origin='clipboard', priority_score=80, governance_status='archived'）
 *   2. 自动方向分类（复用治理管线关键词分类器）
 *   3. 自动 AI 摘要（如果配置了 AI，否则启发式回退）
 *   4. 创建 clip 记录（保存原始粘贴内容）
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { insertArticleIgnoreDuplicate } from '@/server/domains/articles/repositories/articlesRepo';
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';
import { draftGovernanceArticle } from '@/core/governance/aiDraft';
import {
  classifyByKeywords,
  FALLBACK_DIRECTION_KEY,
  listDirectionStrategies,
} from '@/core/governance/directions';
import { insertClip, findClipArticleByLink, upsertClipByArticleId } from '@/core/clips/repository';

type DbClient = Pool | PoolClient;

export const CLIPBOARD_PRIORITY_SCORE = 80;

export interface CreateClipInput {
  userId?: string;
  title?: string;
  contentText: string;
  contentHtml?: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  imageUrls?: string[];
  note?: string | null;
  tags?: string[];
}

export interface CreateClipResult {
  articleId: string;
  directionKey: string;
  directionReason: string;
  qualityScore: number;
  summary: string;
  usedFallback: boolean;
  /** true = 该来源链接此前已收藏过，本次复用既有 article（未新建）。 */
  alreadyExists: boolean;
}

/**
 * 创建快速收藏。
 * 跳过审批，直接归档，固定 80 分。
 * 幂等：同一来源链接（sourceUrl）已收藏过则复用既有 article，刷新 clips 原文。
 */
export async function createClip(
  db: DbClient,
  input: CreateClipInput,
): Promise<CreateClipResult> {
  const scopedUserId = normalizeUserId(input.userId);
  const sourceUrl = input.sourceUrl?.trim() || null;

  // 0. 去重：同一来源链接已收录 → 复用既有 article（真相源唯一），只刷新原文快照
  if (sourceUrl) {
    const existing = await findClipArticleByLink(db, scopedUserId, sourceUrl);
    if (existing) {
      await upsertClipByArticleId(db, {
        articleId: existing.id,
        userId: scopedUserId,
        rawContent: input.contentText,
        rawHtml: input.contentHtml ?? null,
        sourceUrl,
        sourceTitle: input.sourceTitle ?? null,
        imageUrls: input.imageUrls ?? [],
        note: input.note ?? null,
        tags: input.tags,
      });
      return {
        articleId: existing.id,
        directionKey: existing.directionKey ?? FALLBACK_DIRECTION_KEY,
        directionReason: existing.directionReason ?? '已有收藏，复用',
        qualityScore: existing.qualityScore ?? CLIPBOARD_PRIORITY_SCORE,
        summary: existing.summary ?? input.contentText.slice(0, 200),
        usedFallback: false,
        alreadyExists: true,
      };
    }
  }

  // 1. 方向分类（关键词分类器，零成本）
  const strategies = await listDirectionStrategies(db, { userId: scopedUserId, enabledOnly: true });
  const keywordClassified = classifyByKeywords(
    input.title ?? '',
    input.contentText,
    strategies,
  );
  const directionKey = keywordClassified?.directionKey ?? FALLBACK_DIRECTION_KEY;
  const directionReason = keywordClassified
    ? `收藏内容命中关键词「${keywordClassified.matchedKeyword ?? ''}」，归入「${strategies.find((s) => s.key === directionKey)?.name ?? directionKey}」`
    : '收藏内容关键词未命中，归入「其他」';

  // 2. AI 摘要（如果配置了 AI）
  const uiSettings = normalizePersistedSettings(await getUiSettings(db, scopedUserId));
  const aiApiKey = await getAiApiKey(db, scopedUserId);
  const aiConfig = resolveSharedAiConfig({ settings: { ai: uiSettings.ai }, aiApiKey });

  let summary = input.contentText.slice(0, 200);
  let usedFallback = true;

  if (aiConfig) {
    try {
      const draft = await draftGovernanceArticle(
        {
          title: input.title ?? input.contentText.slice(0, 50),
          contentText: input.contentText,
          sourceUrl: input.sourceUrl,
          directions: strategies.map((s) => ({ key: s.key, name: s.name, aiHint: s.aiHint })),
        },
        aiConfig,
      );
      if (!draft.usedFallback && draft.summary) {
        summary = draft.summary;
        usedFallback = false;
      }
    } catch {
      // AI 调用失败，用启发式回退
    }
  }

  // 3. 创建 article（跳过审批，直接归档）
  const article = await insertArticleIgnoreDuplicate(db, {
    userId: scopedUserId,
    feedId: null, // 收藏内容无订阅源
    dedupeKey: `clipboard:${scopedUserId}:${Date.now()}:${input.contentText.slice(0, 50)}`,
    title: input.title ?? input.contentText.slice(0, 80).replace(/\s+/g, ' ').trim(),
    titleOriginal: input.title ?? null,
    link: input.sourceUrl ?? null,
    author: null,
    publishedAt: new Date().toISOString(),
    contentHtml: input.contentHtml ?? null,
    previewImageUrl: input.imageUrls?.[0] ?? null,
    summary,
    sourceLanguage: null,
    filterStatus: 'passed',
    isFiltered: false,
    filteredBy: [],
    filterEvaluatedAt: new Date().toISOString(),
    filterErrorMessage: null,
    governance: {
      status: 'archived',
      qualityScore: CLIPBOARD_PRIORITY_SCORE,
      aiReason: `快速收藏：${directionReason}`,
      directionKey,
      directionReason,
    },
  });

  if (!article) {
    throw new Error('收藏失败：文章创建失败');
  }

  // 4. 更新 origin / priority_score / 收藏备注（用户想法）
  await db.query(
    'update articles set origin = $1, priority_score = $2, user_note = $3 where id = $4',
    ['clipboard', CLIPBOARD_PRIORITY_SCORE, input.note ?? '', article.id],
  );

  // 5. 创建 clip 记录
  await insertClip(db, {
    articleId: article.id,
    userId: scopedUserId,
    rawContent: input.contentText,
    rawHtml: input.contentHtml ?? null,
    sourceUrl: input.sourceUrl ?? null,
    sourceTitle: input.sourceTitle ?? null,
    imageUrls: input.imageUrls ?? [],
    note: input.note ?? null,
    tags: input.tags,
  });

  return {
    articleId: article.id,
    directionKey,
    directionReason,
    qualityScore: CLIPBOARD_PRIORITY_SCORE,
    summary,
    usedFallback,
    alreadyExists: false,
  };
}
