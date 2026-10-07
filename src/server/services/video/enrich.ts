/**
 * 视频链接 → 文案提取 → 回填文章内容。
 *
 * 收藏一个视频链接后，后台跑这条链路：
 *   1. yt-dlp 取内嵌字幕 / 回退 Whisper 语音识别（extractTranscript）
 *   2. 把文案写进 articles.content_html / content_full_html
 *   3. 补一个摘要（二创流水线读的是文章内容）
 *
 * 全程维护 video_materials.transcript_status（extracting / done / failed），
 * 供前端展示进度与「重试」。
 */
import type { Pool, PoolClient } from 'pg';
import { extractTranscript } from './transcript';

type DbClient = Pool | PoolClient;

export interface EnrichTranscriptResult {
  ok: boolean;
  source?: 'subtitle' | 'whisper';
  textLength?: number;
  error?: string;
}

export interface EnrichInput {
  articleId: string;
  userId: string;
  videoUrl: string;
  videoTitle?: string;
  provider?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 文案纯文本 → 段落 HTML。 */
function toParagraphHtml(text: string): string {
  return text
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/** 把底层错误转成用户可读的提示。 */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/Fresh cookies|403|Forbidden/i.test(raw)) return '抖音 Cookie 已失效，请到「设置 → 授权与凭证」重新授权后再重试';
  if (/yt-dlp|not found/i.test(raw)) return '未找到 yt-dlp，请先安装';
  if (/Whisper 模型/.test(raw)) return raw;
  return raw.slice(0, 200) || '文案提取失败';
}

/** 更新 video_materials 的文案提取状态（upsert）。 */
async function setStatus(db: DbClient, input: EnrichInput, status: string, error?: string | null): Promise<void> {
  await db
    .query(
      `insert into video_materials (article_id, user_id, video_url, video_title, provider, transcript_status, transcript_error)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (article_id, user_id)
       do update set
         transcript_status = excluded.transcript_status,
         transcript_error = excluded.transcript_error,
         video_url = coalesce(nullif(excluded.video_url, ''), video_materials.video_url),
         updated_at = now()`,
      [input.articleId, input.userId, input.videoUrl, input.videoTitle ?? '', input.provider ?? '', status, error ?? null],
    )
    .catch(() => {});
}

/**
 * 提取视频文案并回填到文章。
 * 幂等：已有文案时会被新结果覆盖；失败写入 failed 状态与原因，不抛。
 */
export async function enrichArticleWithTranscript(
  db: DbClient,
  input: EnrichInput,
): Promise<EnrichTranscriptResult> {
  await setStatus(db, input, 'extracting', null);

  try {
    const result = await extractTranscript(
      input.videoUrl,
      Number(input.articleId),
      Number(input.userId),
      input.videoTitle,
      input.provider,
    );
    const text = result.text?.trim();
    if (!text) {
      await setStatus(db, input, 'failed', '未提取到文案（可能是纯音乐/无人声视频）');
      return { ok: false, error: '未提取到文案' };
    }

    const html = toParagraphHtml(text);
    const summary = text.replace(/\s+/g, ' ').slice(0, 180);

    await db.query(
      `update articles
         set content_html = $1,
             content_full_html = $1,
             content_full_fetched_at = now(),
             summary = $2,
             governance_updated_at = now()
       where id = $3 and user_id = $4`,
      [html, summary, input.articleId, input.userId],
    );

    await setStatus(db, input, 'done', null);
    return { ok: true, source: result.source, textLength: text.length };
  } catch (err) {
    const message = friendlyError(err);
    await setStatus(db, input, 'failed', message);
    return { ok: false, error: message };
  }
}
