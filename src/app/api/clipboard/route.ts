import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { draftGovernanceArticle } from '@/core/governance/aiDraft';
import {
  classifyByKeywords,
  FALLBACK_DIRECTION_KEY,
  listDirectionStrategies,
} from '@/core/governance/directions';
import { stripHtmlToText } from '@/lib/reader/articleSummary';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';
import { getAiApiKey } from '@/server/domains/settings/repositories/settingsRepo';
import { insertClip } from '@/server/domains/clips/repository';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLIPBOARD_QUALITY_FLOOR = 85;

const clipboardSchema = z.object({
  content: z.string().trim().min(1).max(50000),
  sourceUrl: z.string().trim().url().max(2000).optional().or(z.literal('')),
}).strict();

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        if (!fields[key]) fields[key] = '不支持的参数';
      }
      continue;
    }
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/**
 * POST /api/clipboard — 粘贴收藏。
 * 用户从外部复制内容粘贴进来，跳过审批直接归档。
 * 流程：HTML→纯文本 → AI 拟折 → 方向分类 → quality_score = max(AI, 85) → archived。
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = clipboardSchema.safeParse(body);
    if (!parsed.success) {
      return fail(new ValidationError('Invalid body', zodIssuesToFields(parsed.error)));
    }

    const { content, sourceUrl } = parsed.data;
    const pool = getPool();

    // 1. HTML → 纯文本
    const plainText = stripHtmlToText(content);
    if (!plainText.trim()) {
      return fail(new ValidationError('内容为空', { content: '粘贴的内容无法提取有效文本' }));
    }

    // 2. 尝试 AI 拟折
    const aiApiKey = (await getAiApiKey(pool, session.userId)).trim();
    const aiConfig = resolveSharedAiConfig({ settings: { ai: { model: '', apiBaseUrl: '' } }, aiApiKey });

    const strategies = await listDirectionStrategies(pool, { userId: session.userId, enabledOnly: true });
    const promptDirections = strategies.map((s) => ({ key: s.key, name: s.name, aiHint: s.aiHint }));

    const draft = await draftGovernanceArticle(
      { title: '', contentText: plainText, sourceUrl: sourceUrl || null, directions: promptDirections },
      aiConfig,
    );

    // 3. 方向分类
    const keywordClassified = classifyByKeywords(plainText, '', strategies);
    const directionKey = keywordClassified?.directionKey ?? draft.directionKey ?? FALLBACK_DIRECTION_KEY;
    const directionReason = keywordClassified
      ? `关键词匹配`
      : draft.directionKey
        ? `AI 分类（置信度 ${(draft.directionConfidence ?? 0).toFixed(2)}）`
        : '未命中任何方向，归入兜底';

    // 4. 质量分 = max(AI, 85)
    const qualityScore = Math.max(draft.qualityScore, CLIPBOARD_QUALITY_FLOOR);

    // 5. 入库 — articles (origin = clipboard)
    const dedupeKey = `clipboard:${crypto.createHash('sha256').update(plainText.slice(0, 500)).digest('hex')}`;
    const title = draft.title || plainText.slice(0, 28);
    const summary = draft.summary || plainText.slice(0, 120);

    const { rows } = await pool.query(
      `
      insert into articles(
        user_id, feed_id, dedupe_key, title, title_original, link,
        content_html, summary, preview_image_url, source_language,
        filter_status, is_filtered, filtered_by, filter_evaluated_at,
        governance_status, quality_score, ai_reason, governance_updated_at,
        direction_key, direction_reason, origin, priority_score, fetched_at
      ) values ($1, null, $2, $3, $3, $4, $5, $6, null, null,
                'passed', false, '{}', now(),
                'archived', $7, $8, now(),
                $9, $10, 'clipboard', $11, now())
      on conflict (feed_id, dedupe_key) do nothing
      returning id
      `,
      [
        session.userId,
        dedupeKey,
        title,
        sourceUrl || null,
        content, // 原始 HTML 存 content_html
        summary,
        qualityScore,
        draft.aiReason || '粘贴收藏（用户精选，自动归档）',
        directionKey,
        `[algo clipboard] ${directionReason}`,
        qualityScore,
      ],
    );

    const articleId = rows[0]?.id;
    if (!articleId) {
      // 重复内容，返回已存在的记录
      return ok({ article: { id: null, duplicated: true, title, summary, directionKey, qualityScore } });
    }

    // 6. 存 clips 表（原始内容快照）
    await insertClip(pool, {
      articleId,
      userId: session.userId,
      rawContent: plainText,
      rawHtml: content !== plainText ? content : null,
      sourceUrl: sourceUrl || null,
      sourceTitle: title,
    });

    return ok({
      article: {
        id: articleId,
        title,
        summary,
        directionKey,
        qualityScore,
        origin: 'clipboard',
        duplicated: false,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
