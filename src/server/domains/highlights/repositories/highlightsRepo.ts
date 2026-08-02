import type { Pool } from 'pg';
import type { Highlight, HighlightColor } from '@/types';

interface HighlightRow {
  id: string;
  userId: string;
  articleId: string;
  text: string;
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  color: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const highlightColumnsSql = `
  id,
  user_id as "userId",
  article_id as "articleId",
  text,
  range_start_selector as "rangeStartSelector",
  range_start_offset as "rangeStartOffset",
  range_end_selector as "rangeEndSelector",
  range_end_offset as "rangeEndOffset",
  color,
  note,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function rowToHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    articleId: Number(row.articleId),
    userId: row.userId,
    text: row.text,
    rangeStartSelector: row.rangeStartSelector,
    rangeStartOffset: row.rangeStartOffset,
    rangeEndSelector: row.rangeEndSelector,
    rangeEndOffset: row.rangeEndOffset,
    color: row.color as HighlightColor,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listHighlights(
  pool: Pool,
  userId: string,
  articleId: number,
): Promise<Highlight[]> {
  const { rows } = await pool.query<HighlightRow>(
    `
      select ${highlightColumnsSql}
      from article_highlights
      where user_id = $1
        and article_id = $2
      order by created_at desc
    `,
    [userId, articleId],
  );
  return rows.map(rowToHighlight);
}

export interface CreateHighlightInput {
  userId: string;
  articleId: number;
  text: string;
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  color: HighlightColor;
  note?: string | null;
}

export async function createHighlight(
  pool: Pool,
  params: CreateHighlightInput,
): Promise<Highlight> {
  const { rows } = await pool.query<HighlightRow>(
    `
      insert into article_highlights(
        user_id,
        article_id,
        text,
        range_start_selector,
        range_start_offset,
        range_end_selector,
        range_end_offset,
        color,
        note
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning ${highlightColumnsSql}
    `,
    [
      params.userId,
      params.articleId,
      params.text,
      params.rangeStartSelector,
      params.rangeStartOffset,
      params.rangeEndSelector,
      params.rangeEndOffset,
      params.color,
      params.note ?? null,
    ],
  );
  return rowToHighlight(rows[0]);
}

export interface UpdateHighlightInput {
  color?: HighlightColor;
  note?: string | null;
}

export async function updateHighlight(
  pool: Pool,
  highlightId: string,
  userId: string,
  updates: UpdateHighlightInput,
): Promise<Highlight | null> {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  let idx = 1;

  if (updates.color !== undefined) {
    sets.push(`color = $${idx++}`);
    values.push(updates.color);
  }
  if (updates.note !== undefined) {
    sets.push(`note = $${idx++}`);
    values.push(updates.note);
  }

  if (sets.length === 0) {
    const { rows } = await pool.query<HighlightRow>(
      `
        select ${highlightColumnsSql}
        from article_highlights
        where id = $1
          and user_id = $2
      `,
      [highlightId, userId],
    );
    return rows[0] ? rowToHighlight(rows[0]) : null;
  }

  sets.push(`updated_at = now()`);
  values.push(highlightId);
  values.push(userId);
  const idParamIndex = idx++;
  const userIdParamIndex = idx++;

  const { rows } = await pool.query<HighlightRow>(
    `
      update article_highlights
      set ${sets.join(', ')}
      where id = $${idParamIndex}
        and user_id = $${userIdParamIndex}
      returning ${highlightColumnsSql}
    `,
    values,
  );
  return rows[0] ? rowToHighlight(rows[0]) : null;
}

export async function deleteHighlight(
  pool: Pool,
  highlightId: string,
  userId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `
      delete from article_highlights
      where id = $1
        and user_id = $2
    `,
    [highlightId, userId],
  );
  return (rowCount ?? 0) > 0;
}
