import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countUnreadNotifications,
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/core/notify/repository';
import { notifyOncePerWindow } from '@/core/notify/service';

function mockPool(script: Array<{ match: RegExp; rows: Array<Record<string, unknown>> }>) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    void params;
    for (const rule of script) {
      if (rule.match.test(sql)) return { rows: rule.rows };
    }
    return { rows: [] };
  });
  return { pool: { query }, query };
}

const NOTIFICATION = {
  id: '7',
  userId: '1',
  kind: 'pipeline_done',
  title: '改写完成',
  body: '平台：wechat',
  link: '/studio?tab=drafts',
  readAt: null,
  createdAt: '2026-09-05T10:00:00Z',
};

describe('core/notify repository', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('insertNotification：插入并返回行（userId 归一化）', async () => {
    const { pool, query } = mockPool([{ match: /insert into notifications/, rows: [NOTIFICATION] }]);
    const row = await insertNotification(pool as never, {
      userId: '42',
      kind: 'pipeline_done',
      title: '改写完成',
      body: '平台：wechat',
      link: '/studio?tab=drafts',
    });
    expect(row).toMatchObject({ id: '7', kind: 'pipeline_done' });
    expect(query.mock.calls[0][1]).toEqual(['42', 'pipeline_done', '改写完成', '平台：wechat', '/studio?tab=drafts']);
  });

  it('listNotifications：unreadOnly 加 read_at is null 条件并分页', async () => {
    const { pool, query } = mockPool([
      { match: /count\(\*\)/, rows: [{ count: 3 }] },
      { match: /from notifications/, rows: [NOTIFICATION] },
    ]);
    const result = await listNotifications(pool as never, { userId: '1', unreadOnly: true, page: 2, pageSize: 30 });
    expect(result).toEqual({ items: [NOTIFICATION], total: 3 });
    const listSql = String(query.mock.calls[1][0]);
    expect(listSql).toContain('read_at is null');
    expect(query.mock.calls[1][1]).toEqual(['1', 30, 30]);
  });

  it('countUnreadNotifications：未读计数', async () => {
    const { pool, query } = mockPool([{ match: /read_at is null/, rows: [{ count: 5 }] }]);
    expect(await countUnreadNotifications(pool as never, '1')).toBe(5);
    expect(String(query.mock.calls[0][0])).toContain('read_at is null');
  });

  it('markNotificationRead：幂等（coalesce 保留首次已读时间）；不存在返回 null', async () => {
    const { pool, query } = mockPool([{ match: /update notifications/, rows: [{ ...NOTIFICATION, readAt: '2026-09-05T11:00:00Z' }] }]);
    const row = await markNotificationRead(pool as never, { id: '7', userId: '1' });
    expect(row?.readAt).toBe('2026-09-05T11:00:00Z');
    expect(String(query.mock.calls[0][0])).toContain('coalesce(read_at, now())');

    const empty = mockPool([{ match: /update notifications/, rows: [] }]);
    expect(await markNotificationRead(empty.pool as never, { id: '999', userId: '1' })).toBeNull();
  });

  it('markAllNotificationsRead：只更新未读并返回条数', async () => {
    const { pool, query } = mockPool([{ match: /with updated/, rows: [{ count: 4 }] }]);
    expect(await markAllNotificationsRead(pool as never, '1')).toEqual({ updated: 4 });
    expect(String(query.mock.calls[0][0])).toContain('read_at is null');
  });
});

describe('core/notify service · notifyOncePerWindow（时间窗去重）', () => {
  it('窗内已有同 kind → 跳过返回 null；无记录 → 插入', async () => {
    const skip = mockPool([{ match: /make_interval/, rows: [{ count: 1 }] }]);
    const skipped = await notifyOncePerWindow(skip.pool as never, {
      userId: '1',
      kind: 'pending_backlog',
      title: '积压',
      windowSeconds: 86400,
    });
    expect(skipped).toBeNull();
    expect(skip.query).toHaveBeenCalledTimes(1);

    const empty = mockPool([
      { match: /make_interval/, rows: [{ count: 0 }] },
      { match: /insert into notifications/, rows: [NOTIFICATION] },
    ]);
    const inserted = await notifyOncePerWindow(empty.pool as never, {
      userId: '1',
      kind: 'pending_backlog',
      title: '积压',
      windowSeconds: 86400,
    });
    expect(inserted).toMatchObject({ id: '7' });
    expect(empty.query).toHaveBeenCalledTimes(2);
  });
});
