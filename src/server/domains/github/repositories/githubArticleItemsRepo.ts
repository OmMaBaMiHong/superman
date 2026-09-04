import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import type { GithubArticleItemRow, GithubContentType } from '@/server/domains/github/types';

type DbClient = Pool | PoolClient;

export interface InsertGithubArticleItemInput {
  articleId: string;
  userId?: string;
  feedId: string;
  ghType: GithubContentType;
  ghId: string;
  ghNodeId?: string | null;
  ghNumber?: number | null;
  tagName?: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  bodyMarkdown?: string | null;
  htmlUrl: string;
}

const ARTICLE_ITEM_SELECT_SQL = `
  article_id as "articleId",
  user_id   as "userId",
  feed_id   as "feedId",
  gh_type   as "ghType",
  gh_id     as "ghId",
  gh_node_id as "ghNodeId",
  gh_number as "ghNumber",
  tag_name  as "tagName",
  is_prerelease as "isPrerelease",
  is_draft  as "isDraft",
  body_markdown as "bodyMarkdown",
  html_url  as "htmlUrl"
`;

/** 写入 github_article_items 挂载行；与 articles 共用 (feed_id, gh_type, gh_id) 唯一约束去重。 */
export async function insertGithubArticleItem(
  db: DbClient,
  input: InsertGithubArticleItemInput,
): Promise<GithubArticleItemRow | null> {
  const scopedUserId = normalizeUserId(input.userId);
  const { rows } = await db.query<GithubArticleItemRow>(
    `
      insert into github_article_items(
        article_id,
        user_id,
        feed_id,
        gh_type,
        gh_id,
        gh_node_id,
        gh_number,
        tag_name,
        is_prerelease,
        is_draft,
        body_markdown,
        html_url
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (feed_id, gh_type, gh_id) do nothing
      returning ${ARTICLE_ITEM_SELECT_SQL}
    `,
    [
      input.articleId,
      scopedUserId,
      input.feedId,
      input.ghType,
      input.ghId,
      input.ghNodeId ?? null,
      input.ghNumber ?? null,
      input.tagName ?? null,
      input.isPrerelease,
      input.isDraft,
      input.bodyMarkdown ?? null,
      input.htmlUrl,
    ],
  );
  return rows[0] ?? null;
}

export async function getGithubArticleItemByArticleId(
  db: DbClient,
  articleId: string,
  userId?: string,
): Promise<GithubArticleItemRow | null> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<GithubArticleItemRow>(
    `
      select ${ARTICLE_ITEM_SELECT_SQL}
      from github_article_items
      where article_id = $1 and user_id = $2
      limit 1
    `,
    [articleId, scopedUserId],
  );
  return rows[0] ?? null;
}
