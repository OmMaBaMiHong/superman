import type { Pool } from 'pg';
import type { Board, BoardItem } from '@/types';

interface BoardRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BoardItemRow {
  board_id: string;
  article_id: string | number;
  sort_order: number;
  added_at: Date | string;
}

function toDateIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToBoard(row: BoardRow): Board {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    icon: row.icon ?? '📋',
    sortOrder: row.sort_order,
    createdAt: toDateIso(row.created_at),
    updatedAt: toDateIso(row.updated_at),
  };
}

function rowToBoardItem(row: BoardItemRow): BoardItem {
  return {
    boardId: row.board_id,
    articleId: Number(row.article_id),
    sortOrder: row.sort_order,
    addedAt: toDateIso(row.added_at),
  };
}

export async function listBoards(pool: Pool, userId: string): Promise<Board[]> {
  const { rows } = await pool.query<BoardRow>(
    `SELECT * FROM boards WHERE user_id = $1 ORDER BY sort_order ASC, created_at DESC`,
    [userId],
  );
  return rows.map(rowToBoard);
}

export async function createBoard(
  pool: Pool,
  userId: string,
  title: string,
  description?: string,
  icon?: string,
): Promise<Board> {
  const { rows } = await pool.query<BoardRow>(
    `INSERT INTO boards (user_id, title, description, icon) VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, title, description ?? null, icon ?? '📋'],
  );
  return rowToBoard(rows[0]);
}

export async function updateBoard(
  pool: Pool,
  boardId: string,
  userId: string,
  updates: { title?: string; description?: string; icon?: string; sortOrder?: number },
): Promise<Board | null> {
  const setClauses: string[] = [];
  const values: Array<string | number | null> = [];
  let index = 1;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${index++}`);
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${index++}`);
    values.push(updates.description);
  }
  if (updates.icon !== undefined) {
    setClauses.push(`icon = $${index++}`);
    values.push(updates.icon);
  }
  if (updates.sortOrder !== undefined) {
    setClauses.push(`sort_order = $${index++}`);
    values.push(updates.sortOrder);
  }

  setClauses.push(`updated_at = NOW()`);

  const boardIdIndex = index++;
  const userIdIndex = index;
  values.push(boardId, userId);

  const { rows } = await pool.query<BoardRow>(
    `UPDATE boards SET ${setClauses.join(', ')} WHERE id = $${boardIdIndex} AND user_id = $${userIdIndex} RETURNING *`,
    values,
  );
  return rows[0] ? rowToBoard(rows[0]) : null;
}

export async function deleteBoard(pool: Pool, boardId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM boards WHERE id = $1 AND user_id = $2`,
    [boardId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listBoardItems(pool: Pool, boardId: string, userId: string): Promise<BoardItem[]> {
  const { rows: boardRows } = await pool.query(
    `SELECT 1 FROM boards WHERE id = $1 AND user_id = $2`,
    [boardId, userId],
  );
  if (boardRows.length === 0) return [];

  const { rows } = await pool.query<BoardItemRow>(
    `SELECT * FROM board_items WHERE board_id = $1 ORDER BY sort_order ASC, added_at DESC`,
    [boardId],
  );
  return rows.map(rowToBoardItem);
}

export async function addArticleToBoard(
  pool: Pool,
  boardId: string,
  articleId: number,
  sortOrder?: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO board_items (board_id, article_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT (board_id, article_id) DO NOTHING`,
    [boardId, articleId, sortOrder ?? 0],
  );
}

export async function removeArticleFromBoard(
  pool: Pool,
  boardId: string,
  articleId: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM board_items WHERE board_id = $1 AND article_id = $2`,
    [boardId, articleId],
  );
  return (rowCount ?? 0) > 0;
}
