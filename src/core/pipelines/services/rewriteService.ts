/**
 * 洗稿 job 执行核心：pipeline_jobs(rewrite) → LLM 按平台 profile 改写
 * → bigram 相似度校验（>0.5 自动降重重写一次）→ drafts 落库。
 *
 * 与治理层拟折不同，这条链路没有启发式回退：LLM 未配置/失败直接把
 * job 置 failed 并写明 error，由用户显式重试（retry API）。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import {
  isAiRuntimeConfigComplete,
  resolveSharedAiConfig,
  type AiRuntimeConfig,
} from '@/server/integrations/ai/runtimeConfig';
import { createOpenAIClient } from '@/server/integrations/ai/openaiClient';
import { extractAssistantText } from '@/server/integrations/ai/providerCompatibility';
import { stripHtmlToText } from '@/lib/reader/articleSummary';
import { normalizeTitle, titleSimilarity } from '@/core/governance/dedup';
import {
  REWRITE_PROFILES,
  buildRewritePrompt,
  isRewritePlatform,
  parseRewriteOutput,
} from '@/core/pipelines/rewriteProfiles';
import {
  classifyOriginality,
  needsReduceSimilarityPass,
  type OriginalityFlag,
} from '@/core/pipelines/originality';
import {
  getPipelineArticle,
  getPipelineJob,
  insertDraft,
  markPipelineJobFailed,
  markPipelineJobRunning,
  markPipelineJobSucceeded,
} from '@/core/pipelines/repository';

type DbClient = Pool | PoolClient;

export interface RewriteExecuteResult {
  status: 'succeeded' | 'failed';
  draftId?: string;
  similarityScore?: number;
  originalityFlag?: OriginalityFlag;
  error?: string;
}

export interface RewriteExecuteDeps {
  /** 测试注入：替代 LLM 调用，入参 prompt，返回模型文本。 */
  complete?: (input: { prompt: string; config: AiRuntimeConfig }) => Promise<string>;
  /** 测试注入：替代 bigram 相似度计算。 */
  similarity?: (a: string, b: string) => number;
}

async function defaultComplete(input: {
  prompt: string;
  config: AiRuntimeConfig;
}): Promise<string> {
  const client = createOpenAIClient({
    apiBaseUrl: input.config.apiBaseUrl,
    apiKey: input.config.apiKey,
    source: 'server/pipelines/rewrite',
    requestLabel: 'Pipeline rewrite request',
  });
  const completion = await client.chat.completions.create({
    model: input.config.model,
    temperature: 0.7,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: input.prompt }],
  });
  const text = extractAssistantText(
    completion.choices?.[0]?.message as { content?: unknown } | null | undefined,
  );
  if (!text) throw new Error('洗稿响应为空');
  return text;
}

function bodySimilarity(
  similarityFn: (a: string, b: string) => number,
  originalText: string,
  body: string,
): number {
  return similarityFn(normalizeTitle(originalText), normalizeTitle(body));
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function executeRewriteJob(
  db: DbClient,
  input: { jobId: string; userId?: string },
  deps?: RewriteExecuteDeps,
): Promise<RewriteExecuteResult> {
  const scopedUserId = normalizeUserId(input.userId);

  const job = await getPipelineJob(db, input.jobId, scopedUserId);
  if (!job) return { status: 'failed', error: '任务不存在' };
  // 幂等：已成功的任务不重复执行。
  if (job.status === 'succeeded') return { status: 'succeeded' };

  await markPipelineJobRunning(db, job.id);

  const fail = async (error: string): Promise<RewriteExecuteResult> => {
    await markPipelineJobFailed(db, job.id, error);
    return { status: 'failed', error };
  };

  try {
    if (job.kind !== 'rewrite') {
      return await fail(`暂不支持的 pipeline 类型：${job.kind}`);
    }
    if (!isRewritePlatform(job.platform)) {
      return await fail(`未知的洗稿平台：${job.platform}`);
    }
    const profile = REWRITE_PROFILES[job.platform];

    const article = await getPipelineArticle(db, job.articleId, scopedUserId);
    if (!article) return await fail('选题文章不存在或已被删除');

    const originalText = stripHtmlToText(article.contentFullHtml ?? article.contentHtml ?? '');
    if (!originalText) return await fail('原文内容为空，无法洗稿');

    const uiSettings = normalizePersistedSettings(await getUiSettings(db, scopedUserId));
    const aiApiKey = await getAiApiKey(db, scopedUserId);
    const aiConfig = resolveSharedAiConfig({
      settings: { ai: uiSettings.ai },
      aiApiKey,
    });
    const complete = deps?.complete ?? defaultComplete;
    if (!deps?.complete && !isAiRuntimeConfigComplete(aiConfig)) {
      return await fail('未配置 AI（模型/接口地址/API Key），无法执行洗稿');
    }

    const similarityFn = deps?.similarity ?? ((a: string, b: string) => titleSimilarity(a, b));
    const promptInput = {
      title: article.title,
      contentText: originalText,
      sourceUrl: article.link,
    };

    // 第一轮改写。
    const firstText = await complete({ prompt: buildRewritePrompt(profile, promptInput), config: aiConfig });
    let output = parseRewriteOutput(firstText);
    let similarity = bodySimilarity(similarityFn, originalText, output.body);

    // 相似度 > 0.5：自动带「降重」指令重写一次（原创度红线）。
    let rewrittenOnce = false;
    if (needsReduceSimilarityPass(similarity)) {
      rewrittenOnce = true;
      const secondText = await complete({
        prompt: buildRewritePrompt(profile, { ...promptInput, reduceSimilarity: true }),
        config: aiConfig,
      });
      output = parseRewriteOutput(secondText);
      similarity = bodySimilarity(similarityFn, originalText, output.body);
    }

    const originalityFlag = classifyOriginality(similarity);
    const similarityScore = Math.round(similarity * 1000) / 1000;
    const draft = await insertDraft(db, {
      userId: scopedUserId,
      articleId: job.articleId,
      jobId: job.id,
      platform: job.platform,
      title: output.title,
      body: output.body,
      similarityScore,
      originalityFlag,
    });

    await markPipelineJobSucceeded(db, job.id, {
      draftId: draft.id,
      platform: job.platform,
      similarityScore,
      originalityFlag,
      rewrittenOnce,
    });
    return {
      status: 'succeeded',
      draftId: draft.id,
      similarityScore,
      originalityFlag,
    };
  } catch (err) {
    return await fail(`洗稿执行失败：${stringifyError(err)}`);
  }
}
