/**
 * 随记 / 计划（memos）—— flomo 式随手记 + 日历规划。
 *
 * kind: note=随记（created_at 即记忆锚点，无时间）| plan=计划（due_at 落日历，先只标记不推送）。
 * 标签：正文 #标签 自动解析 + 显式 tags 合并去重；可关联收藏（article_id）。
 * 日历口径：计划醒目（open/total）+ 当天收录数（articles.fetched_at）作记忆锚点小点。
 */

export interface QueryRunner {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: any[] }>;
}

export type MemoKind = 'note' | 'plan';

export interface MemoRow {
  id: number;
  kind: MemoKind;
  content: string;
  tags: string[];
  articleId: number | null;
  articleTitle: string | null;
  articlePreview: string | null;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
}

/** 正文里的 #标签（1-24 字，中文/字母数字，遇空白或常用标点截止）。 */
const INLINE_TAG_RE = /#([^#\s，。；！？、,;!?…"']{1,24})/g;

export function parseInlineTags(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(INLINE_TAG_RE)) out.add(m[1]);
  return [...out];
}

function mergeTags(content: string, explicit?: string[]): string[] {
  const tags = new Set(parseInlineTags(content));
  for (const t of explicit ?? []) {
    const cleaned = t.trim().replace(/^#/, '');
    if (cleaned) tags.add(cleaned.slice(0, 24));
  }
  return [...tags].slice(0, 10);
}

function normalizeKind(kind: string | undefined, dueAt: string | null | undefined): MemoKind {
  if (kind === 'plan' || kind === 'note') return kind;
  return dueAt ? 'plan' : 'note';
}

const memoSelect = `
  select m.id, m.kind, m.content, m.tags, m.article_id,
         a.title as article_title, a.preview_image_url as article_preview,
         m.due_at, m.done_at, m.created_at
  from memos m
  left join articles a on a.id = m.article_id
`;

function mapMemo(r: any): MemoRow {
  return {
    id: Number(r.id),
    kind: r.kind,
    content: r.content ?? '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    articleId: r.article_id != null ? Number(r.article_id) : null,
    articleTitle: r.article_title ?? null,
    articlePreview: r.article_preview ?? null,
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    doneAt: r.done_at ? new Date(r.done_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function createMemo(
  db: QueryRunner,
  input: { userId: number | string; content: string; kind?: string; dueAt?: string | null; articleId?: number | string | null; tags?: string[] },
): Promise<MemoRow> {
  const content = (input.content ?? '').trim().slice(0, 5000);
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new Error('计划时间格式不正确');
  const kind = normalizeKind(input.kind, input.dueAt);
  const tags = mergeTags(content, input.tags);
  const { rows } = await db.query(
    `insert into memos (user_id, kind, content, tags, article_id, due_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.userId, kind, content, tags, input.articleId ?? null, dueAt],
  );
  const list = await db.query(`${memoSelect} where m.id = $1`, [rows[0].id]);
  return mapMemo(list.rows[0]);
}

export async function listMemos(
  db: QueryRunner,
  opts: { userId: number | string; from?: string; to?: string; tag?: string; kind?: string; limit?: number; offset?: number },
): Promise<MemoRow[]> {
  const wheres: string[] = ['m.user_id = $1'];
  const params: unknown[] = [opts.userId];
  if (opts.from) {
    params.push(new Date(opts.from));
    wheres.push(`coalesce(m.due_at, m.created_at) >= $${params.length}`);
  }
  if (opts.to) {
    params.push(new Date(opts.to));
    wheres.push(`coalesce(m.due_at, m.created_at) < $${params.length}`);
  }
  if (opts.tag) {
    params.push(opts.tag);
    wheres.push(`$${params.length} = any(m.tags)`);
  }
  if (opts.kind === 'note' || opts.kind === 'plan') {
    params.push(opts.kind);
    wheres.push(`m.kind = $${params.length}`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  params.push(limit);
  const offset = Math.max(opts.offset ?? 0, 0);
  params.push(offset);
  const { rows } = await db.query(
    `${memoSelect} where ${wheres.join(' and ')} order by m.created_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return rows.map(mapMemo);
}

export async function updateMemo(
  db: QueryRunner,
  input: { id: number | string; userId: number | string; content?: string; dueAt?: string | null; done?: boolean; tags?: string[] },
): Promise<MemoRow | null> {
  const current = await db.query('select content, tags from memos where id = $1 and user_id = $2', [input.id, input.userId]);
  if (!current.rows[0]) return null;

  const params: unknown[] = [input.id, input.userId];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const sets: string[] = [];

  if (input.content !== undefined || input.tags !== undefined) {
    const content = (input.content !== undefined ? input.content : String(current.rows[0].content ?? '')).trim().slice(0, 5000);
    const explicit = input.tags ?? (Array.isArray(current.rows[0].tags) ? current.rows[0].tags : []);
    sets.push(`content = ${push(content)}`, `tags = ${push(mergeTags(content, explicit))}`);
  }
  if (input.dueAt !== undefined) {
    const dueDate = input.dueAt ? new Date(input.dueAt) : null;
    if (dueDate && Number.isNaN(dueDate.getTime())) throw new Error('计划时间格式不正确');
    // 有时间即计划；清空时间退回随记
    sets.push(`due_at = ${push(dueDate)}`, `kind = ${push(dueDate ? 'plan' : 'note')}`);
  }
  if (input.done !== undefined) {
    sets.push(`done_at = ${push(input.done ? new Date() : null)}`);
  }

  if (sets.length > 0) {
    await db.query(`update memos set ${sets.join(', ')}, updated_at = now() where id = $1 and user_id = $2`, params);
  }
  const list = await db.query(`${memoSelect} where m.id = $1`, [input.id]);
  return list.rows[0] ? mapMemo(list.rows[0]) : null;
}

export async function deleteMemo(db: QueryRunner, id: number | string, userId: number | string): Promise<boolean> {
  const res = await db.query('delete from memos where id = $1 and user_id = $2 returning id', [id, userId]);
  return res.rows.length > 0;
}

export interface CalendarDay {
  plansOpen: number;
  plansTotal: number;
  memos: number;
  collected: number;
}

/** 月历聚合：计划（open/total）+ 随记数 + 当天收藏数（记忆锚点）。month = yyyy-MM。 */
export async function getCalendarMonth(
  db: QueryRunner,
  userId: number | string,
  month: string,
): Promise<Record<string, CalendarDay>> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式应为 yyyy-MM');
  const start = new Date(`${month}-01T00:00:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const result: Record<string, CalendarDay> = {};
  const touch = (day: string): CalendarDay => {
    result[day] ??= { plansOpen: 0, plansTotal: 0, memos: 0, collected: 0 };
    return result[day];
  };
  const dayKey = (v: string | Date): string => {
    const d = new Date(v);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const plans = await db.query(
    `select due_at, done_at is not null as done from memos
     where user_id = $1 and kind = 'plan' and due_at >= $2 and due_at < $3`,
    [userId, start, end],
  );
  for (const r of plans.rows) {
    const day = touch(dayKey(r.due_at));
    day.plansTotal += 1;
    if (!r.done) day.plansOpen += 1;
  }
  const notes = await db.query(
    `select created_at from memos where user_id = $1 and created_at >= $2 and created_at < $3`,
    [userId, start, end],
  );
  for (const r of notes.rows) touch(dayKey(r.created_at)).memos += 1;
  const collected = await db.query(
    `select fetched_at from articles
     where user_id = $1 and (origin = 'clipboard' or is_favorited = true) and fetched_at >= $2 and fetched_at < $3`,
    [userId, start, end],
  );
  for (const r of collected.rows) touch(dayKey(r.fetched_at)).collected += 1;

  return result;
}
