/**
 * 剪贴板收藏数据仓储。
 */
import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export interface ClipRow {
  id: string;
  articleId: string;
  userId: string;
  rawContent: string;
  rawHtml: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  imageUrls: unknown;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertClipInput {
  articleId: string | number;
  userId: string;
  rawContent: string;
  rawHtml?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  imageUrls?: string[];
  note?: string | null;
}

const clipRowColumns =
  'id::text as "id", article_id::text as "articleId", user_id::text as "userId", raw_content as "rawContent", raw_html as "rawHtml", source_url as "sourceUrl", source_title as "sourceTitle", image_urls as "imageUrls", note, created_at as "createdAt", updated_at as "updatedAt"';

export async function insertClip(db: DbClient, input: InsertClipInput): Promise<ClipRow> {
  const { rows } = await db.query<ClipRow>(
    `
    insert into clips (article_id, user_id, raw_content, raw_html, source_url, source_title, image_urls, note)
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning ${clipRowColumns}
    `,
    [
      input.articleId,
      input.userId,
      input.rawContent,
      input.rawHtml ?? null,
      input.sourceUrl ?? null,
      input.sourceTitle ?? null,
      JSON.stringify(input.imageUrls ?? []),
      input.note ?? null,
    ],
  );
  return rows[0];
}

export async function getClipByArticleId(db: DbClient, articleId: string): Promise<ClipRow | null> {
  const { rows } = await db.query<ClipRow>(
    `select ${clipRowColumns} from clips where article_id = $1`,
    [articleId],
  );
  return rows[0] ?? null;
}

/** 已存在的剪贴板收藏（按来源链接去重时复用）。 */
export interface ExistingClipArticle {
  id: string;
  directionKey: string | null;
  directionReason: string | null;
  summary: string | null;
  qualityScore: number | null;
}

/**
 * 按来源链接查同一用户的剪贴板收藏。命中即视为「已收录」，
 * 调用方复用该 article（真相源唯一），不再新建。
 */
export async function findClipArticleByLink(
  db: DbClient,
  userId: string,
  link: string,
): Promise<ExistingClipArticle | null> {
  const { rows } = await db.query<ExistingClipArticle>(
    `
    select
      id::text as "id",
      direction_key as "directionKey",
      direction_reason as "directionReason",
      summary,
      quality_score as "qualityScore"
    from articles
    where user_id = $1 and origin = 'clipboard' and link = $2
    order by id desc
    limit 1
    `,
    [userId, link],
  );
  return rows[0] ?? null;
}

/** 覆盖写回 clips 原始快照（去重命中时刷新原文，保持一份真相源）。 */
export async function upsertClipByArticleId(
  db: DbClient,
  input: InsertClipInput,
): Promise<void> {
  await db.query(
    `
    insert into clips (article_id, user_id, raw_content, raw_html, source_url, source_title, image_urls, note)
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (article_id) do update set
      raw_content = excluded.raw_content,
      raw_html = excluded.raw_html,
      image_urls = excluded.image_urls,
      note = coalesce(excluded.note, clips.note),
      updated_at = now()
    `,
    [
      input.articleId,
      input.userId,
      input.rawContent,
      input.rawHtml ?? null,
      input.sourceUrl ?? null,
      input.sourceTitle ?? null,
      JSON.stringify(input.imageUrls ?? []),
      input.note ?? null,
    ],
  );
}

export async function listClips(
  db: DbClient,
  userId: string,
  options?: { limit?: number; offset?: number },
): Promise<{ items: ClipRow[]; total: number }> {
  const limit = Math.min(options?.limit ?? 20, 100);
  const offset = options?.offset ?? 0;
  const { rows } = await db.query<ClipRow & { totalCount: number }>(
    `
    select ${clipRowColumns}, count(*) over()::int as "totalCount"
    from clips
    where user_id = $1
    order by created_at desc
    limit $2 offset $3
    `,
    [userId, limit, offset],
  );
  return {
    items: rows,
    total: rows[0]?.totalCount ?? 0,
  };
}
