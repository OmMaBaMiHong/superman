/**
 * 产品计划服务：两条入口 + 定时批量扫描。
 *
 *   ① 人工口述（manual）：用户输入一句/一段想法 → AI 整理成 MVP 规划；
 *   ② 内容推理（ai_inferred）：从已归档的「搞钱」方向文章提炼产品机会；
 *   ③ 批量扫描：定时/手动扫描尚未生成计划的候选文章，逐篇生成。
 *
 * AI 未配置或调用失败时回退启发式（用来源文本填充描述），绝不阻塞落库。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { resolveSharedAiConfig, type AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';
import { generateProductPlan, generateRemixIdeas, type ProductPlanDraft } from '@/core/product-plans/aiPlan';
import { extractFirstUrl } from '@/lib/url/extractUrl';
import {
  createProductPlan,
  findArticleIdByLink,
  getProductPlan,
  getProductPlanByArticle,
  getProductPlanSourceArticle,
  listProductPlanScanCandidates,
  normalizePipeline,
  updateProductPlan,
  PRODUCT_PLAN_SOURCE_DIRECTION,
  type ProductPlanPipeline,
  type ProductPlanRow,
  type ProductPlanSourceArticle,
  type ProductPlanStep,
  type UpdateProductPlanPatch,
} from '@/core/product-plans/repository';

type DbClient = Pool | PoolClient;

/** 从 settings 解析 AI 运行时配置；未配置/免费模式异常时返回 null（走启发式回退）。 */
export async function resolveProductPlanAiConfig(
  db: DbClient,
  userId?: string,
): Promise<AiRuntimeConfig | null> {
  try {
    const scopedUserId = normalizeUserId(userId);
    const uiSettings = normalizePersistedSettings(await getUiSettings(db, scopedUserId));
    const aiApiKey = await getAiApiKey(db, scopedUserId);
    return resolveSharedAiConfig({ settings: { ai: uiSettings.ai }, aiApiKey });
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function draftToColumns(draft: ProductPlanDraft) {
  return {
    title: draft.title,
    oneLiner: draft.oneLiner,
    productDesc: draft.productDesc,
    targetUsers: draft.targetUsers,
    approach: draft.approach,
    businessModel: draft.businessModel,
    risks: draft.risks,
    competitors: draft.competitors,
    pricing: draft.pricing,
    milestones: draft.milestones,
    validationPlan: draft.validationPlan,
    direction: draft.direction,
  };
}

// ============================================================
// 流水线步骤（闭环）：来源 → 文案 → 产品化分析 → 二创思路
// ============================================================

const VIDEO_HOST_RE = /(bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|youtube\.com|youtu\.be|kuaishou\.com|ixigua\.com)/i;

function nowIso(): string {
  return new Date().toISOString();
}

function doneStep(note?: string): ProductPlanStep {
  return note ? { status: 'done', note, at: nowIso() } : { status: 'done', at: nowIso() };
}

function failedStep(note: string): ProductPlanStep {
  return { status: 'failed', note, at: nowIso() };
}

function skippedStep(note: string): ProductPlanStep {
  return { status: 'skipped', note, at: nowIso() };
}

export function isVideoUrl(link: string | null | undefined): boolean {
  return typeof link === 'string' && VIDEO_HOST_RE.test(link);
}

function detectVideoProvider(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  if (/douyin|iesdouyin/i.test(link)) return 'douyin';
  if (/bilibili|b23\.tv/i.test(link)) return 'bilibili';
  if (/youtube|youtu\.be/i.test(link)) return 'youtube';
  if (/kuaishou/i.test(link)) return 'kuaishou';
  if (/ixigua/i.test(link)) return 'ixigua';
  return undefined;
}

function buildSourceText(
  article: { title: string; summary: string | null; content: string | null } | null,
  fallback: string,
): string {
  if (!article) return fallback;
  return [article.title, article.summary, article.content ? stripHtml(article.content) : '']
    .filter(Boolean)
    .join('\n\n');
}

/** 文案步骤：来源是视频且正文为空 → 提取文案（yt-dlp 字幕 / Whisper，抖音需 cookies）。 */
async function runTranscriptStep(
  db: DbClient,
  userId: string,
  article: { id: string; title: string; link: string | null; content: string | null } | null,
): Promise<ProductPlanStep> {
  if (!article) return skippedStep('无来源文章（人工想法）');
  if (!isVideoUrl(article.link)) return doneStep('非视频来源，正文已就绪');
  const hasContent = Boolean(article.content && stripHtml(article.content).trim());
  if (hasContent) return doneStep('已有正文/文案');

  try {
    const { enrichArticleWithTranscript } = await import('@/server/services/video/enrich');
    const result = await enrichArticleWithTranscript(db, {
      articleId: article.id,
      userId,
      videoUrl: article.link as string,
      videoTitle: article.title,
      provider: detectVideoProvider(article.link),
    });
    if (result.ok) return doneStep(`文案 ${result.textLength ?? 0} 字（${result.source ?? 'unknown'}）`);
    return failedStep(result.error ?? '文案提取失败');
  } catch (err) {
    return failedStep(err instanceof Error ? err.message : '文案提取失败');
  }
}

/** 产品化分析步骤：产出 MVP 规划 + 产品化方向。 */
async function runAnalysisStep(
  sourceText: string,
  sourceTitle: string | null | undefined,
  sourceUrl: string | null | undefined,
  note: string | null | undefined,
  mode: 'manual' | 'article',
  aiConfig: AiRuntimeConfig | null,
): Promise<{ step: ProductPlanStep; draft: ProductPlanDraft }> {
  const draft = await generateProductPlan({ sourceText, sourceTitle, sourceUrl, note, mode }, aiConfig);
  return { step: draft.usedFallback ? failedStep('AI 未配置，启发式占位（可补全）') : doneStep(), draft };
}

/** 二创思路步骤：把内容改造成短剧/漫剧/口播/图文的具体方向。 */
async function runRemixStep(
  sourceText: string,
  sourceTitle: string | null | undefined,
  mode: 'manual' | 'article',
  aiConfig: AiRuntimeConfig | null,
): Promise<{ step: ProductPlanStep; remixIdeas: string }> {
  const draft = await generateRemixIdeas({ sourceText, sourceTitle, mode }, aiConfig);
  return {
    step: draft.usedFallback ? failedStep('AI 未配置，二创思路待补') : doneStep(),
    remixIdeas: draft.remixIdeas,
  };
}

export interface CreateManualPlanResult {
  plan: ProductPlanRow;
  usedFallback: boolean;
  /** true = 该链接已收录过且已生成计划，本次幂等返回既有计划。 */
  alreadyExists: boolean;
}

/**
 * 人工口述想法 → 产品计划。
 * rawIdea 为空时抛错（由调用方翻译成 400）。
 * 想法里含链接且该链接已收录 → 自动挂到对应文章（真相源唯一），并幂等复用既有计划。
 */
export async function createManualProductPlan(
  db: DbClient,
  input: { userId?: string; rawIdea: string; note?: string | null; aiConfig?: AiRuntimeConfig | null },
): Promise<CreateManualPlanResult> {
  const scopedUserId = normalizeUserId(input.userId);
  const rawIdea = input.rawIdea.trim();
  if (!rawIdea) throw new Error('rawIdea 不能为空');

  // 关联真相源：想法里若含链接且已收录，挂到该文章；同文章已有计划则幂等返回。
  const linkedUrl = extractFirstUrl(rawIdea);
  let sourceArticleId: string | null = null;
  let article: ProductPlanSourceArticle | null = null;
  if (linkedUrl) {
    sourceArticleId = await findArticleIdByLink(db, linkedUrl, scopedUserId);
    if (sourceArticleId) {
      const existing = await getProductPlanByArticle(db, sourceArticleId, scopedUserId);
      if (existing) return { plan: existing, usedFallback: false, alreadyExists: true };
      article = await getProductPlanSourceArticle(db, sourceArticleId, scopedUserId);
    }
  }

  const aiConfig = input.aiConfig ?? (await resolveProductPlanAiConfig(db, scopedUserId));

  // 走一遍流水线：来源 → 文案 → 产品化分析 → 二创思路
  const pipeline: ProductPlanPipeline = {
    source: sourceArticleId ? doneStep('已关联收藏来源') : skippedStep('人工想法，无来源链接'),
    transcript: await runTranscriptStep(db, scopedUserId, article),
    analysis: { status: 'pending' },
    remix: { status: 'pending' },
  };

  const refreshed = sourceArticleId
    ? await getProductPlanSourceArticle(db, sourceArticleId, scopedUserId)
    : null;
  const sourceText = buildSourceText(refreshed, rawIdea);

  const analysis = await runAnalysisStep(
    sourceText,
    refreshed?.title ?? null,
    linkedUrl ?? null,
    input.note ?? null,
    'manual',
    aiConfig,
  );
  pipeline.analysis = analysis.step;
  const remix = await runRemixStep(sourceText, refreshed?.title ?? null, 'manual', aiConfig);
  pipeline.remix = remix.step;

  const plan = await createProductPlan(db, {
    userId: scopedUserId,
    ...draftToColumns(analysis.draft),
    remixIdeas: remix.remixIdeas,
    pipeline,
    status: 'idea',
    sourceType: 'manual',
    sourceArticleId,
    sourceUrl: linkedUrl ?? null,
    sourceNote: rawIdea.slice(0, 4000),
    aiGenerated: !analysis.draft.usedFallback,
  });
  return { plan, usedFallback: analysis.draft.usedFallback, alreadyExists: false };
}

export interface CreateFromArticleResult {
  plan: ProductPlanRow;
  usedFallback: boolean;
  alreadyExists: boolean;
}

/**
 * 从一篇文章（采集内容）推理产品计划。
 * 幂等：同一文章已生成过计划时直接返回既有计划。
 * 文章不存在时返回 null（由调用方翻译成 404）。
 */
export async function createProductPlanFromArticle(
  db: DbClient,
  input: { userId?: string; articleId: string; aiConfig?: AiRuntimeConfig | null },
): Promise<CreateFromArticleResult | null> {
  const scopedUserId = normalizeUserId(input.userId);
  const article = await getProductPlanSourceArticle(db, input.articleId, scopedUserId);
  if (!article) return null;

  const existing = await getProductPlanByArticle(db, input.articleId, scopedUserId);
  if (existing) return { plan: existing, usedFallback: false, alreadyExists: true };

  const aiConfig = input.aiConfig ?? (await resolveProductPlanAiConfig(db, scopedUserId));

  // 走一遍流水线：来源 → 文案 → 产品化分析 → 二创思路
  const pipeline: ProductPlanPipeline = {
    source: doneStep('已关联来源内容'),
    transcript: await runTranscriptStep(db, scopedUserId, article),
    analysis: { status: 'pending' },
    remix: { status: 'pending' },
  };

  const refreshed = (await getProductPlanSourceArticle(db, input.articleId, scopedUserId)) ?? article;
  const sourceText = buildSourceText(refreshed, refreshed.title);

  const analysis = await runAnalysisStep(sourceText, refreshed.title, refreshed.link, null, 'article', aiConfig);
  pipeline.analysis = analysis.step;
  const remix = await runRemixStep(sourceText, refreshed.title, 'article', aiConfig);
  pipeline.remix = remix.step;

  const plan = await createProductPlan(db, {
    userId: scopedUserId,
    ...draftToColumns(analysis.draft),
    remixIdeas: remix.remixIdeas,
    pipeline,
    status: 'idea',
    sourceType: 'ai_inferred',
    sourceArticleId: article.id,
    sourceUrl: article.link,
    aiGenerated: !analysis.draft.usedFallback,
  });
  return { plan, usedFallback: analysis.draft.usedFallback, alreadyExists: false };
}

export interface RunPipelineResult {
  plan: ProductPlanRow;
  pipeline: ProductPlanPipeline;
}

/**
 * 补齐 / 重跑产品计划流水线（source → transcript → analysis → remix）。
 * 默认只补缺失步骤；force=true 全部重跑。计划不存在返回 null。
 */
export async function runProductPlanPipeline(
  db: DbClient,
  input: { userId?: string; planId: string; aiConfig?: AiRuntimeConfig | null; force?: boolean },
): Promise<RunPipelineResult | null> {
  const plan = await getProductPlan(db, input.planId, input.userId);
  if (!plan) return null;
  const scopedUserId = plan.userId;
  const force = input.force === true;
  const aiConfig = input.aiConfig ?? (await resolveProductPlanAiConfig(db, scopedUserId));
  const pipeline = normalizePipeline(plan.pipeline);

  let article = plan.sourceArticleId
    ? await getProductPlanSourceArticle(db, plan.sourceArticleId, scopedUserId)
    : null;

  // source
  pipeline.source = plan.sourceArticleId || plan.sourceUrl
    ? doneStep('已关联来源')
    : skippedStep('无来源链接');

  // transcript
  if (force || pipeline.transcript.status !== 'done') {
    pipeline.transcript = await runTranscriptStep(db, scopedUserId, article);
    if (plan.sourceArticleId) {
      article = await getProductPlanSourceArticle(db, plan.sourceArticleId, scopedUserId);
    }
  }

  const sourceText = buildSourceText(article, plan.sourceNote ?? plan.title);
  const mode: 'manual' | 'article' = article ? 'article' : 'manual';
  const patch: UpdateProductPlanPatch = {};

  // analysis
  if (force || !plan.productDesc.trim() || !plan.direction.trim()) {
    const analysis = await runAnalysisStep(
      sourceText,
      article?.title ?? plan.title,
      plan.sourceUrl,
      plan.sourceNote,
      mode,
      aiConfig,
    );
    Object.assign(patch, draftToColumns(analysis.draft));
    pipeline.analysis = analysis.step;
  } else {
    pipeline.analysis = doneStep('已有规划');
  }

  // remix
  if (force || !plan.remixIdeas.trim()) {
    const remix = await runRemixStep(sourceText, article?.title ?? plan.title, mode, aiConfig);
    if (remix.remixIdeas) patch.remixIdeas = remix.remixIdeas;
    pipeline.remix = remix.step;
  } else {
    pipeline.remix = doneStep('已有二创思路');
  }

  patch.pipeline = pipeline;
  const updated = await updateProductPlan(db, plan.id, patch, scopedUserId);
  return { plan: updated ?? plan, pipeline };
}

export interface ScanResult {
  scanned: number;
  created: number;
  usedFallback: number;
}

/**
 * 批量扫描候选（缺省「搞钱」方向已归档文章），逐篇生成产品计划。
 * AI 未配置时仍会生成启发式占位计划（可在 UI 里继续编辑）。
 */
export async function scanProductPlanCandidates(
  db: DbClient,
  input: { userId?: string; limit?: number; directions?: string[]; aiConfig?: AiRuntimeConfig | null },
): Promise<ScanResult> {
  const scopedUserId = normalizeUserId(input.userId);
  const candidates = await listProductPlanScanCandidates(db, {
    userId: scopedUserId,
    directions: input.directions?.length ? input.directions : [PRODUCT_PLAN_SOURCE_DIRECTION],
    limit: input.limit ?? 10,
  });
  if (candidates.length === 0) return { scanned: 0, created: 0, usedFallback: 0 };

  const aiConfig = input.aiConfig ?? (await resolveProductPlanAiConfig(db, scopedUserId));
  let created = 0;
  let usedFallback = 0;

  for (const article of candidates) {
    const result = await createProductPlanFromArticle(db, {
      userId: scopedUserId,
      articleId: article.id,
      aiConfig,
    });
    if (result && !result.alreadyExists) {
      created += 1;
      if (result.usedFallback) usedFallback += 1;
    }
  }

  return { scanned: candidates.length, created, usedFallback };
}
