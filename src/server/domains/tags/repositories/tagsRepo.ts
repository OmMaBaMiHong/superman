import type { Pool, PoolClient } from 'pg';
import type { Tag } from '@/types';
import { ConflictError } from '@/server/infra/http/errors';

type DbClient = Pool | PoolClient;

interface TagRow {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: Date | string;
}

function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: String(row.color ?? 'gray'),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export async function listTags(pool: DbClient, userId: string): Promise<Tag[]> {
  const { rows } = await pool.query<TagRow>(
    `select * from tags where user_id = $1 order by created_at desc`,
    [userId],
  );
  return rows.map(rowToTag);
}

export async function createTag(
  pool: DbClient,
  userId: string,
  name: string,
  color?: string,
): Promise<Tag> {
  try {
    const { rows } = await pool.query<TagRow>(
      `insert into tags (user_id, name, color) values ($1, $2, $3) returning *`,
      [userId, name, color ?? 'gray'],
    );
    return rowToTag(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('标签名已存在');
    }
    throw err;
  }
}

export async function updateTag(
  pool: DbClient,
  tagId: string,
  userId: string,
  updates: { name?: string; color?: string },
): Promise<Tag | null> {
  const setClauses: string[] = [];
  const values: Array<string> = [];
  let index = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${index++}`);
    values.push(updates.name);
  }
  if (updates.color !== undefined) {
    setClauses.push(`color = $${index++}`);
    values.push(updates.color);
  }

  if (setClauses.length === 0) {
    const { rows } = await pool.query<TagRow>(
      `select * from tags where id = $1 and user_id = $2`,
      [tagId, userId],
    );
    return rows[0] ? rowToTag(rows[0]) : null;
  }

  const tagIdIndex = index++;
  const userIdIndex = index;
  values.push(tagId, userId);

  const { rows } = await pool.query<TagRow>(
    `update tags set ${setClauses.join(', ')} where id = $${tagIdIndex} and user_id = $${userIdIndex} returning *`,
    values,
  );
  return rows[0] ? rowToTag(rows[0]) : null;
}

export async function deleteTag(
  pool: DbClient,
  tagId: string,
  userId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from tags where id = $1 and user_id = $2`,
    [tagId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getArticleTags(
  pool: DbClient,
  articleId: number,
): Promise<Tag[]> {
  const { rows } = await pool.query<TagRow>(
    `
      select t.*
      from tags t
      join article_tags at on at.tag_id = t.id
      where at.article_id = $1
      order by at.created_at desc
    `,
    [articleId],
  );
  return rows.map(rowToTag);
}

export async function addTagsToArticle(
  pool: DbClient,
  articleId: number,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;

  const values: Array<string | number> = [];
  const tuples = tagIds.map((tagId, index) => {
    const offset = index * 2;
    values.push(articleId, tagId);
    return `($${offset + 1}, $${offset + 2})`;
  });

  await pool.query(
    `insert into article_tags (article_id, tag_id) values ${tuples.join(', ')} on conflict do nothing`,
    values,
  );
}

export async function removeTagFromArticle(
  pool: DbClient,
  articleId: number,
  tagId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from article_tags where article_id = $1 and tag_id = $2`,
    [articleId, tagId],
  );
  return (rowCount ?? 0) > 0;
}
