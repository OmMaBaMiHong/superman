/**
 * 消息中心服务（P2a）：notify / 时间窗去重通知。
 * 事件源（调度器 / API 路由）调这里，仓储保持纯 SQL。
 */
import type { Pool, PoolClient } from 'pg';
import {
  hasNotificationInWindow,
  insertNotification,
  type NotificationKind,
  type NotificationRow,
} from './repository';

type DbClient = Pool | PoolClient;

/** 写一条通知。 */
export async function notify(
  db: DbClient,
  input: {
    userId?: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    link?: string | null;
  },
): Promise<NotificationRow> {
  return insertNotification(db, input);
}

/** 时间窗内最多一条（防抖）：窗内已有同 kind 通知则返回 null。 */
export async function notifyOncePerWindow(
  db: DbClient,
  input: {
    userId?: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    link?: string | null;
    windowSeconds: number;
  },
): Promise<NotificationRow | null> {
  const exists = await hasNotificationInWindow(db, {
    userId: input.userId,
    kind: input.kind,
    windowSeconds: input.windowSeconds,
  });
  if (exists) return null;
  return insertNotification(db, input);
}
