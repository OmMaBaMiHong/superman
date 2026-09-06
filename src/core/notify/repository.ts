/**
 * 消息中心仓储（P2a）。
 * 一条事件一条通知；kind 受 0054 check 约束限定。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';

type DbClient = Pool | PoolClient;

export type NotificationKind =
  | 'fetch_failed'
  | 'pending_backlog'
  | 'pipeline_done'
  | 'redraft_done'
  | 'system'
  | 'performance_hot'
  | 'comment_intel';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'fetch_failed',
  'pending_backlog',
  'pipeline_done',
  'redraft_done',
  'system',
  'performance_hot',
  'comment_intel',
];

export interface NotificationRow {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const notificationSelectSql = `
  id::text as "id",
  user_id::text as "userId",
  kind,
  title,
  body,
  link,
  read_at as "readAt",
  created_at as "createdAt"
`;

export async function insertNotification(
  db: DbClient,
  input: {
    userId?: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    link?: string | null;
  },
): Promise<NotificationRow> {
  const { rows } = await db.query<NotificationRow>(
    `
      insert into notifications (user_id, kind, title, body, link)
      values ($1, $2, $3, $4, $5)
      returning ${notificationSelectSql}
    `,
    [
      normalizeUserId(input.userId),
      input.kind,
      input.title,
      input.body ?? '',
      input.link ?? null,
    ],
  );
  return rows[0];
}

export async function listNotifications(
  db: DbClient,
  input: {
    userId?: string;
    unreadOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
): Promise<{ items: NotificationRow[]; total: number }> {
  const scopedUserId = normalizeUserId(input.userId);
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.round(input.pageSize ?? 30)));

  const conditions = ['user_id = $1'];
  if (input.unreadOnly) conditions.push('read_at is null');
  const whereSql = conditions.join(' and ');

  const { rows: countRows } = await db.query<{ count: number }>(
    `select count(*)::int as count from notifications where ${whereSql}`,
    [scopedUserId],
  );
  const { rows } = await db.query<NotificationRow>(
    `
      select ${notificationSelectSql}
      from notifications
      where ${whereSql}
      order by created_at desc, id desc
      limit $2 offset $3
    `,
    [scopedUserId, pageSize, (page - 1) * pageSize],
  );
  return { items: rows, total: countRows[0]?.count ?? 0 };
}

export async function countUnreadNotifications(db: DbClient, userId?: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'select count(*)::int as count from notifications where user_id = $1 and read_at is null',
    [normalizeUserId(userId)],
  );
  return rows[0]?.count ?? 0;
}

/** 标记已读；返回 null 表示条目不存在或不属于该用户。 */
export async function markNotificationRead(
  db: DbClient,
  input: { id: string; userId?: string },
): Promise<NotificationRow | null> {
  const { rows } = await db.query<NotificationRow>(
    `
      update notifications
      set read_at = coalesce(read_at, now())
      where id = $1 and user_id = $2
      returning ${notificationSelectSql}
    `,
    [input.id, normalizeUserId(input.userId)],
  );
  return rows[0] ?? null;
}

export async function markAllNotificationsRead(db: DbClient, userId?: string): Promise<{ updated: number }> {
  const { rows } = await db.query<{ count: number }>(
    `
      with updated as (
        update notifications
        set read_at = now()
        where user_id = $1 and read_at is null
        returning 1
      )
      select count(*)::int as count from updated
    `,
    [normalizeUserId(userId)],
  );
  return { updated: rows[0]?.count ?? 0 };
}

/** 时间窗去重（如 pending_backlog 每 24h 最多一条）：窗内已有同 kind 记录（不论已读）则跳过。 */
export async function hasNotificationInWindow(
  db: DbClient,
  input: { userId?: string; kind: NotificationKind; windowSeconds: number },
): Promise<boolean> {
  const { rows } = await db.query<{ count: number }>(
    `
      select count(*)::int as count
      from notifications
      where user_id = $1
        and kind = $2
        and created_at > now() - make_interval(secs => $3)
    `,
    [normalizeUserId(input.userId), input.kind, Math.max(1, Math.round(input.windowSeconds))],
  );
  return (rows[0]?.count ?? 0) > 0;
}
