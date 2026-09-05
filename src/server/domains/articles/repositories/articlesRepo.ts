import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { indexArticle } from '@/server/integrations/knowledge/indexingService';

export type DbClient = Pool | PoolClient;

export type ArticleFilterStatus = 'pending' | 'passed' | 'filtered' | 'error';
export type ArticleDuplicateReason =
  | 'same_normalized_url'
  | 'same_title'
  | 'similar_content';

const articleRowColumnsSql = `
  id,
  user_id::text as "userId",
  feed_id as "feedId",
  dedupe_key as "dedupeKey",
  title,
  title_original as "titleOriginal",
  title_zh as "titleZh",
  title_translation_model as "titleTranslationModel",
  title_translation_attempts as "titleTranslationAttempts",
  title_translation_error as "titleTranslationError",
  title_translated_at as "titleTranslatedAt",
  link,
  author,
  published_at as "publishedAt",
  fetched_at as "fetchedAt",
  content_html as "contentHtml",
  content_full_html as "contentFullHtml",
  content_full_fetched_at as "contentFullFetchedAt",
  content_full_error as "contentFullError",
  content_full_source_url as "contentFullSourceUrl",
  preview_image_url as "previewImageUrl",
  ai_summary as "aiSummary",
  ai_summary_model as "aiSummaryModel",
  ai_summarized_at as "aiSummarizedAt",
  ai_translation_bilingual_html as "aiTranslationBilingualHtml",
  ai_translation_zh_html as "aiTranslationZhHtml",
  ai_translation_model as "aiTranslationModel",
  ai_translated_at as "aiTranslatedAt",
  summary,
  source_language as "sourceLanguage",
  normalized_title as "normalizedTitle",
  normalized_link as "normalizedLink",
  content_fingerprint as "contentFingerprint",
  duplicate_of_article_id as "duplicateOfArticleId",
  duplicate_reason as "duplicateReason",
  duplicate_score as "duplicateScore",
  duplicate_checked_at as "duplicateCheckedAt",
  filter_status as "filterStatus",
  is_filtered as "isFiltered",
  filtered_by as "filteredBy",
  filter_evaluated_at as "filterEvaluatedAt",
  filter_error_message as "filterErrorMessage",
  is_read as "isRead",
  read_at as "readAt",
  is_starred as "isStarred",
  starred_at as "starredAt"
`;

export interface ArticleRow {
  id: string;
  userId: string;
  feedId: string;
  dedupeKey: string;
  title: string;
  titleOriginal: string;
  titleZh: string | null;
  titleTranslationModel: string | null;
  titleTranslationAttempts: number;
  titleTranslationError: string | null;
  titleTranslatedAt: string | null;
  link: string | null;
  author: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  contentHtml: string | null;
  contentFullHtml: string | null;
  contentFullFetchedAt: string | null;
  contentFullError: string | null;
  contentFullSourceUrl: string | null;
  previewImageUrl: string | null;
  aiSummary: string | null;
  aiSummaryModel: string | null;
  aiSummarizedAt: string | null;
  aiTranslationBilingualHtml: string | null;
  aiTranslationZhHtml: string | null;
  aiTranslationModel: string | null;
  aiTranslatedAt: string | null;
  summary: string | null;
  sourceLanguage: string | null;
  normalizedTitle: string | null;
  normalizedLink: string | null;
  contentFingerprint: string | null;
  duplicateOfArticleId: string | null;
  duplicateReason: ArticleDuplicateReason | null;
  duplicateScore: number | null;
  duplicateCheckedAt: string | null;
  filterStatus: ArticleFilterStatus;
  isFiltered: boolean;
  filteredBy: string[];
  filterEvaluatedAt: string | null;
  filterErrorMessage: string | null;
  isRead: boolean;
  readAt: string | null;
  isStarred: boolean;
  starredAt: string | null;
}

export interface ArticleSearchRow {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  titleOriginal: string | null;
  titleZh: string | null;
  summary: string | null;
  bodyText: string;
  publishedAt: string | null;
}

export interface ArticleSearchResult {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  titleOriginal: string | null;
  titleZh: string | null;
  summary: string;
  excerpt: string;
  publishedAt: string | null;
}

export interface ArticleMediaAttachmentRow {
  id: string;
  articleId: string;
  url: string;
  mimeType: string;
  sizeBytes: string | null;
  durationSeconds: number | null;
}

export interface ArticleMediaAttachmentInput {
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

function normalizeSearchKeyword(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function tokenizeSearchKeyword(keyword: string): string[] {
  return Array.from(new Set(normalizeSearchKeyword(keyword).split(' ').filter(Boolean))).slice(0, 8);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function indexOfTerm(text: string, terms: string[]): number {
  const lower = text.toLowerCase();

  return terms.reduce((minIndex, term) => {
    const nextIndex = lower.indexOf(term.toLowerCase());
    if (nextIndex < 0) {
      return minIndex;
    }

    return minIndex < 0 ? nextIndex : Math.min(minIndex, nextIndex);
  }, -1);
}

function buildExcerpt(input: {
  summary?: string | null;
  bodyText: string;
  terms: string[];
}): string {
  const normalizedSummary = input.summary?.trim() ?? '';
  const normalizedBody = stripHtml(input.bodyText);
  const preferredText = normalizedSummary || normalizedBody;

  if (!preferredText) {
    return '';
  }

  const matchIndex = indexOfTerm(preferredText, input.terms);
  if (matchIndex < 0) {
    return preferredText.slice(0, 180);
  }

  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(preferredText.length, matchIndex + 132);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < preferredText.length ? '...' : '';

  return `${prefix}${preferredText.slice(start, end).trim()}${suffix}`;
}

export interface ArticleGovernanceInput {
  status: 'candidate' | 'archived';
  title?: string;
  summary?: string | null;
  qualityScore: number | null;
  aiReason: string | null;
}

export async function insertArticleIgnoreDuplicate(
  pool: DbClient,
  input: {
    feedId: string;
    dedupeKey: string;
    title: string;
    titleOriginal?: string | null;
    link?: string | null;
    author?: string | null;
    publishedAt?: string | null;
    contentHtml?: string | null;
    previewImageUrl?: string | null;
    summary?: string | null;
    sourceLanguage?: string | null;
    filterStatus?: ArticleFilterStatus;
    isFiltered?: boolean;
    filteredBy?: string[];
    filterEvaluatedAt?: string | null;
    filterErrorMessage?: string | null;
    /**
     * 治理管线结果。缺省（null）表示非治理链路（Fever/GitHub/AI 摘要等存量资产流），
     * 落库为 'archived' 且不打治理时间戳，不进待批队列。
     */
    governance?: ArticleGovernanceInput | null;
    userId?: string;
  },
): Promise<ArticleRow | null> {
  const scopedUserId = normalizeUserId(input.userId);
  const filterStatus = input.filterStatus ?? 'passed';
  const isFiltered = input.isFiltered ?? false;
  const filteredBy = input.filteredBy ?? [];
  const filterEvaluatedAt =
    typeof input.filterEvaluatedAt !== 'undefined'
      ? input.filterEvaluatedAt
      : filterStatus === 'pending'
        ? null
        : new Date().toISOString();
  const governanceStatus = input.governance?.status ?? 'archived';
  const governanceUpdatedAt = input.governance ? new Date().toISOString() : null;

  const { rows } = await pool.query<ArticleRow>(
    `
      insert into articles(
        user_id,
        feed_id,
        dedupe_key,
        title,
        title_original,
        link,
        author,
        published_at,
        content_html,
        summary,
        preview_image_url,
        source_language,
        filter_status,
        is_filtered,
        filtered_by,
        filter_evaluated_at,
        filter_error_message,
        governance_status,
        quality_score,
        ai_reason,
        governance_updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      on conflict (feed_id, dedupe_key) do nothing
      returning ${articleRowColumnsSql}
    `,
    [
      scopedUserId,
      input.feedId,
      input.dedupeKey,
      input.title,
      input.titleOriginal ?? input.title,
      input.link ?? null,
      input.author ?? null,
      input.publishedAt ?? null,
      input.contentHtml ?? null,
      input.summary ?? null,
      input.previewImageUrl ?? null,
      input.sourceLanguage ?? null,
      filterStatus,
      isFiltered,
      filteredBy,
      filterEvaluatedAt,
      input.filterErrorMessage ?? null,
      governanceStatus,
      input.governance?.qualityScore ?? null,
      input.governance?.aiReason ?? null,
      governanceUpdatedAt,
    ],
  );
  const article = rows[0] ?? null;
  if (article) {
    // 非阻塞异步索引：文章入库后自动生成向量索引，失败不影响入库结果
    void indexArticle(Number(article.id), article.title, article.contentHtml ?? '').catch(
      (err) => {
        console.error(`[knowledge] Failed to index article ${article.id}:`, err);
      },
    );
  }
  return article;
}

export async function getArticleByFeedAndDedupeKey(
  pool: DbClient,
  input: { feedId: string; dedupeKey: string; userId?: string },
): Promise<ArticleRow | null> {
  const { rows } = await pool.query<ArticleRow>(
    `
      select ${articleRowColumnsSql}
      from articles
      where user_id = $1
        and feed_id = $2
        and dedupe_key = $3
      limit 1
    `,
    [normalizeUserId(input.userId), input.feedId, input.dedupeKey],
  );
  return rows[0] ?? null;
}

export async function getArticleById(
  pool: DbClient,
  id: string,
  userId?: string,
): Promise<ArticleRow | null> {
  const { rows } = await pool.query<ArticleRow>(
    `
      select ${articleRowColumnsSql}
      from articles
      where id = $1
        and user_id = $2
    `,
    [id, normalizeUserId(userId)],
  );
  return rows[0] ?? null;
}

export async function insertArticleMediaAttachments(
  pool: DbClient,
  articleId: string,
  attachments: ArticleMediaAttachmentInput[],
  userId?: string,
): Promise<void> {
  if (attachments.length === 0) return;

  const values: Array<string | number | null> = [];
  const tuples = attachments.map((attachment, index) => {
    const offset = index * 7;
    values.push(
      normalizeUserId(userId),
      articleId,
      attachment.url,
      attachment.mimeType,
      attachment.sizeBytes,
      attachment.durationSeconds,
      index,
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
  });

  await pool.query(
    `
      insert into article_media_attachments(
        user_id,
        article_id,
        url,
        mime_type,
        size_bytes,
        duration_seconds,
        position
      )
      values ${tuples.join(', ')}
      on conflict (user_id, article_id, url) do nothing
    `,
    values,
  );
}

export async function listArticleMediaAttachments(
  pool: DbClient,
  articleId: string,
  userId?: string,
): Promise<ArticleMediaAttachmentRow[]> {
  const { rows } = await pool.query<ArticleMediaAttachmentRow>(
    `
      select
        id,
        article_id as "articleId",
        url,
        mime_type as "mimeType",
        size_bytes as "sizeBytes",
        duration_seconds as "durationSeconds"
      from article_media_attachments
      where article_id = $1
        and user_id = $2
      order by position asc, id asc
    `,
    [articleId, normalizeUserId(userId)],
  );
  return rows;
}

export async function searchArticles(
  pool: DbClient,
  input: {
    keyword: string;
    limit?: number;
    userId?: string;
  },
): Promise<ArticleSearchResult[]> {
  const normalizedKeyword = normalizeSearchKeyword(input.keyword);
  const terms = tokenizeSearchKeyword(normalizedKeyword);

  if (terms.length === 0) {
    return [];
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const searchableSql = `
    trim(
      concat_ws(
        ' ',
        coalesce(articles.title_zh, ''),
        coalesce(articles.title, ''),
        coalesce(articles.title_original, ''),
        coalesce(articles.summary, ''),
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(articles.content_full_html, articles.content_html, ''), '<script[\\s\\S]*?<\\/script>', ' ', 'gi'),
            '<style[\\s\\S]*?<\\/style>',
            ' ',
            'gi'
          ),
          '<[^>]+>',
          ' ',
          'g'
        )
      )
    )
  `;
  const params: Array<string | number> = [normalizeUserId(input.userId)];
  const searchConditions = terms.map((term) => {
    params.push(`%${escapeLikePattern(term)}%`);
    return `${searchableSql} ilike $${params.length} escape '\\'`;
  });

  params.push(`%${escapeLikePattern(normalizedKeyword)}%`);
  const exactKeywordParamIndex = params.length;
  params.push(limit);
  const limitParamIndex = params.length;

  const { rows } = await pool.query<ArticleSearchRow>(
    `
      select
        articles.id,
        articles.feed_id as "feedId",
        feeds.title as "feedTitle",
        articles.title,
        articles.title_original as "titleOriginal",
        articles.title_zh as "titleZh",
        articles.summary,
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(articles.content_full_html, articles.content_html, ''), '<script[\\s\\S]*?<\\/script>', ' ', 'gi'),
            '<style[\\s\\S]*?<\\/style>',
            ' ',
            'gi'
          ),
          '<[^>]+>',
          ' ',
          'g'
        ) as "bodyText",
        articles.published_at as "publishedAt"
      from articles
      inner join feeds on feeds.id = articles.feed_id
      where articles.filter_status = any('{passed,error}'::text[])
        and articles.user_id = $1
        and feeds.user_id = $1
        and ${searchConditions.join('\n        and ')}
      order by
        case
          when coalesce(articles.title_zh, articles.title, '') ilike $${exactKeywordParamIndex} escape '\\' then 0
          when coalesce(articles.title_original, '') ilike $${exactKeywordParamIndex} escape '\\' then 1
          when coalesce(articles.summary, '') ilike $${exactKeywordParamIndex} escape '\\' then 2
          else 3
        end,
        coalesce(articles.published_at, 'epoch'::timestamptz) desc,
        articles.id desc
      limit $${limitParamIndex}
    `,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    feedId: row.feedId,
    feedTitle: row.feedTitle,
    title: row.titleZh?.trim() || row.title,
    titleOriginal: row.titleOriginal,
    titleZh: row.titleZh,
    summary: row.summary?.trim() ?? '',
    excerpt: buildExcerpt({
      summary: row.summary,
      bodyText: row.bodyText,
      terms,
    }),
    publishedAt: row.publishedAt,
  }));
}

export async function setArticleRead(
  pool: DbClient,
  id: string,
  isRead: boolean,
  userId?: string,
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        is_read = $2,
        read_at = case when $2 then coalesce(read_at, now()) else null end
      where id = $1
        and user_id = $3
    `,
    [id, isRead, normalizeUserId(userId)],
  );
}

export async function setArticleStarred(
  pool: DbClient,
  id: string,
  isStarred: boolean,
  userId?: string,
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        is_starred = $2,
        starred_at = case when $2 then coalesce(starred_at, now()) else null end
      where id = $1
        and user_id = $3
    `,
    [id, isStarred, normalizeUserId(userId)],
  );
}

export async function markAllRead(
  pool: DbClient,
  input: { feedId?: string; excludeArticleIds?: string[]; userId?: string },
): Promise<number> {
  const params: string[] = ['user_id = $1'];
  const values: string[] = [normalizeUserId(input.userId)];
  let index = 2;

  if (input.feedId) {
    params.push(`feed_id = $${index++}`);
    values.push(input.feedId);
  }

  if (input.excludeArticleIds?.length) {
    params.push(`id <> all($${index++}::bigint[])`);
    values.push(`{${input.excludeArticleIds.join(',')}}`);
  }

  const whereParts = [...params, 'is_read = false'];

  const { rowCount } = await pool.query(
    `
      update articles
      set
        is_read = true,
        read_at = coalesce(read_at, now())
      where ${whereParts.join(' and ')}
    `,
    values,
  );
  return rowCount ?? 0;
}

export async function setArticleFilterPending(pool: Pool, id: string, userId?: string): Promise<void> {
  await pool.query(
    `
      update articles
      set
        filter_status = 'pending',
        is_filtered = false,
        filtered_by = '{}'::text[],
        normalized_title = null,
        normalized_link = null,
        content_fingerprint = null,
        duplicate_of_article_id = null,
        duplicate_reason = null,
        duplicate_score = null,
        duplicate_checked_at = null,
        filter_evaluated_at = null,
        filter_error_message = null
      where id = $1
        and user_id = $2
    `,
    [id, normalizeUserId(userId)],
  );
}

export async function setArticleFilterResult(
  pool: DbClient,
  id: string,
  input: {
    filterStatus: Extract<ArticleFilterStatus, 'passed' | 'filtered' | 'error'>;
    isFiltered: boolean;
    filteredBy: string[];
    filterErrorMessage?: string | null;
    normalizedTitle?: string | null;
    normalizedLink?: string | null;
    contentFingerprint?: string | null;
    duplicateOfArticleId?: string | null;
    duplicateReason?: ArticleDuplicateReason | null;
    duplicateScore?: number | null;
    userId?: string;
  },
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        filter_status = $2,
        is_filtered = $3,
        filtered_by = $4,
        filter_evaluated_at = now(),
        filter_error_message = $5,
        normalized_title = $6,
        normalized_link = $7,
        content_fingerprint = $8,
        duplicate_of_article_id = $9,
        duplicate_reason = $10,
        duplicate_score = $11,
        duplicate_checked_at = now()
      where id = $1
        and user_id = $12
    `,
    [
      id,
      input.filterStatus,
      input.isFiltered,
      input.filteredBy,
      input.filterErrorMessage ?? null,
      input.normalizedTitle ?? null,
      input.normalizedLink ?? null,
      input.contentFingerprint ?? null,
      input.duplicateOfArticleId ?? null,
      input.duplicateReason ?? null,
      input.duplicateScore ?? null,
      normalizeUserId(input.userId),
    ],
  );
}

export async function listArticleDuplicateCandidates(
  pool: DbClient,
  input: { articleId: string; publishedAt: string | null; fetchedAt: string; userId?: string },
): Promise<ArticleRow[]> {
  const { rows } = await pool.query<ArticleRow>(
    `
      -- Only compare against records that already existed so a newer article never replaces an earlier representative.
      select ${articleRowColumnsSql}
      from articles
      where user_id = $1
        and id <> $2
        and (fetched_at < $3 or (fetched_at = $3 and id < $2::bigint))
        and coalesce(published_at, fetched_at) >= coalesce($4::timestamptz, $3::timestamptz) - interval '72 hours'
        and coalesce(published_at, fetched_at) <= coalesce($4::timestamptz, $3::timestamptz) + interval '72 hours'
      order by fetched_at asc, id asc
    `,
    [
      normalizeUserId(input.userId),
      input.articleId,
      input.fetchedAt,
      input.publishedAt,
    ],
  );
  return rows;
}

export async function pruneFeedArticlesToLimit(
  db: DbClient,
  feedId: string,
  maxStoredArticlesPerFeed: number,
  userId?: string,
): Promise<{ deletedCount: number }> {
  const scopedUserId = normalizeUserId(userId);
  const res = await db.query(
    `
      with overflow as (
        select greatest(count(*)::int - $2::int, 0) as overflow_count
        from articles
        where user_id = $3
          and feed_id = $1
      ),
      deletable as (
        select id
        from articles
        where user_id = $3
          and feed_id = $1
          and is_starred = false
        order by coalesce(published_at, fetched_at) asc, id asc
        limit (select overflow_count from overflow)
      )
      delete from articles
      where user_id = $3
        and id in (select id from deletable)
    `,
    [feedId, maxStoredArticlesPerFeed, scopedUserId],
  );

  return { deletedCount: res.rowCount ?? 0 };
}

export async function pruneAllFeedsArticlesToLimit(
  db: DbClient,
  maxStoredArticlesPerFeed: number,
  userId?: string,
): Promise<{ deletedCount: number }> {
  const scopedUserId = normalizeUserId(userId);
  const res = await db.query(
    `
      with overflow as (
        select
          feed_id,
          greatest(count(*)::int - $1::int, 0) as overflow_count
        from articles
        where user_id = $2
        group by feed_id
        having count(*) > $1::int
      ),
      ranked_unstarred as (
        select
          a.id,
          a.feed_id,
          row_number() over (
            partition by a.feed_id
            order by coalesce(a.published_at, a.fetched_at) asc, a.id asc
          ) as delete_rank
        from articles a
        join overflow o on o.feed_id = a.feed_id
        where a.user_id = $2
          and a.is_starred = false
      ),
      deletable as (
        select r.id
        from ranked_unstarred r
        join overflow o on o.feed_id = r.feed_id
        where r.delete_rank <= o.overflow_count
      )
      delete from articles
      where user_id = $2
        and id in (select id from deletable)
    `,
    [maxStoredArticlesPerFeed, scopedUserId],
  );

  return { deletedCount: res.rowCount ?? 0 };
}

export async function setArticleFulltext(
  pool: Pool,
  id: string,
  input: { contentFullHtml: string; sourceUrl: string | null; userId?: string },
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        content_full_html = $2,
        content_full_fetched_at = now(),
        content_full_error = null,
        content_full_source_url = $3
      where id = $1
        and user_id = $4
    `,
    [id, input.contentFullHtml, input.sourceUrl, normalizeUserId(input.userId)],
  );
}

export async function setArticleAiSummary(
  pool: Pool,
  id: string,
  input: { aiSummary: string; aiSummaryModel: string; userId?: string },
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        ai_summary = $2,
        ai_summary_model = $3,
        ai_summarized_at = now()
      where id = $1
        and user_id = $4
    `,
    [id, input.aiSummary, input.aiSummaryModel, normalizeUserId(input.userId)],
  );
}

export async function setArticleAiTranslationZh(
  pool: Pool,
  id: string,
  input: { aiTranslationZhHtml: string; aiTranslationModel: string; userId?: string },
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        ai_translation_zh_html = $2,
        ai_translation_model = $3,
        ai_translated_at = now()
      where id = $1
        and user_id = $4
    `,
    [id, input.aiTranslationZhHtml, input.aiTranslationModel, normalizeUserId(input.userId)],
  );
}

export async function setArticleAiTranslationBilingual(
  pool: Pool,
  id: string,
  input: { aiTranslationBilingualHtml: string; aiTranslationModel: string; userId?: string },
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        ai_translation_bilingual_html = $2,
        ai_translation_model = $3,
        ai_translated_at = now()
      where id = $1
        and user_id = $4
    `,
    [id, input.aiTranslationBilingualHtml, input.aiTranslationModel, normalizeUserId(input.userId)],
  );
}

export async function setArticleTitleTranslation(
  pool: Pool,
  id: string,
  input: { titleZh: string; titleTranslationModel: string; userId?: string },
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        title_zh = $2,
        title_translation_model = $3,
        title_translated_at = now(),
        title_translation_error = null
      where id = $1
        and user_id = $4
    `,
    [id, input.titleZh, input.titleTranslationModel, normalizeUserId(input.userId)],
  );
}

export async function recordArticleTitleTranslationFailure(
  pool: Pool,
  id: string,
  input: { error: string; userId?: string },
): Promise<number> {
  const { rows } = await pool.query<{ titleTranslationAttempts: number }>(
    `
      update articles
      set
        title_translation_attempts = coalesce(title_translation_attempts, 0) + 1,
        title_translation_error = $2
      where id = $1
        and user_id = $3
      returning title_translation_attempts as "titleTranslationAttempts"
    `,
    [id, input.error, normalizeUserId(input.userId)],
  );
  return rows[0]?.titleTranslationAttempts ?? 0;
}

export async function setArticleFulltextError(
  pool: Pool,
  id: string,
  input: { error: string; sourceUrl: string | null; userId?: string },
): Promise<void> {
  await pool.query(
    `
      update articles
      set
        content_full_error = $2,
        content_full_source_url = $3
      where id = $1
        and user_id = $4
    `,
    [id, input.error, input.sourceUrl, normalizeUserId(input.userId)],
  );
}
