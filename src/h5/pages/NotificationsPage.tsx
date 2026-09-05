'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, PenLine, RefreshCw, Rss, Stamp } from 'lucide-react';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
  type NotificationKind,
} from '@/lib/api/apiClient';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';
import { navigateTo } from '../lib/router';
import { cn } from '@/lib/utils';

const POLL_MS = 30_000;

const KIND_META: Record<NotificationKind, { label: string; Icon: typeof Bell; dotClass: string }> = {
  fetch_failed: { label: '采集失败', Icon: Rss, dotClass: 'bg-error' },
  pending_backlog: { label: '待批积压', Icon: Stamp, dotClass: 'bg-warning' },
  pipeline_done: { label: '流水线', Icon: PenLine, dotClass: 'bg-primary' },
  redraft_done: { label: '重拟完成', Icon: RefreshCw, dotClass: 'bg-primary' },
  system: { label: '系统', Icon: Bell, dotClass: 'bg-muted-foreground' },
};

/** 相对时间：x 分钟前 / x 小时前 / x 天前。 */
function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

/** 按天分组键（zh-CN 本地日期）。 */
function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知日期';
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

/**
 * 消息中心页（P2a）：按天分组列表 + 未读点 + 点击已读并跳 link + 全部已读。
 * 预留：Web Push（PWA）——通知写入后由 SW push 订阅推送（本批次不落，只留注释位）。
 */
export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await listNotifications({ pageSize: 50 }, { notifyOnError: false });
      setItems(result.items);
      setTotal(result.total);
    } catch {
      // 静默
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const handleOpen = useCallback((item: NotificationItem) => {
    if (!item.readAt) {
      // 乐观更新：先灭未读点
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry,
        ),
      );
      void markNotificationRead(item.id, { notifyOnError: false }).catch(() => {});
    }
    if (item.link) navigateTo(item.link);
  }, []);

  const handleMarkAll = useCallback(() => {
    setMarkingAll(true);
    void markAllNotificationsRead()
      .then(() => {
        const now = new Date().toISOString();
        setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt ?? now })));
      })
      .catch(() => {})
      .finally(() => setMarkingAll(false));
  }, []);

  const groups = items.reduce<Array<{ day: string; entries: NotificationItem[] }>>((acc, item) => {
    const day = dayKey(item.createdAt);
    const last = acc[acc.length - 1];
    if (last && last.day === day) last.entries.push(item);
    else acc.push({ day, entries: [item] });
    return acc;
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 顶部指挥条 */}
      <header className="glass-surface-strong sticky top-0 z-10 rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Bell aria-hidden="true" className="h-4 w-4 text-primary" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">消息</h1>
              <p className="text-[11px] text-muted-foreground">Notification Center</p>
            </div>
          </div>
          <button
            type="button"
            disabled={markingAll || items.every((item) => item.readAt !== null)}
            onClick={handleMarkAll}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-medium text-muted-foreground',
              'transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" />
            {markingAll ? '处理中…' : '全部已读'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-28 pt-5 sm:px-6 md:pb-10">
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="gov-card h-20 animate-pulse [--gov-accent:var(--glass-border)]" aria-hidden="true" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
            <Bell aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-foreground">暂无新消息</p>
            <p className="mt-2 text-xs text-muted-foreground">
              采集失败、改写完成、待批积压都会在这里提醒你。
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.day} aria-label={group.day}>
                <h2 className="mb-2 px-1 text-[12px] font-semibold text-muted-foreground">{group.day}</h2>
                <ul className="space-y-2">
                  {group.entries.map((item) => {
                    const meta = KIND_META[item.kind] ?? KIND_META.system;
                    const unread = item.readAt === null;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-testid="notification-row"
                          data-unread={unread}
                          onClick={() => handleOpen(item)}
                          className={cn(
                            'gov-card flex w-full items-start gap-3 p-3.5 text-left [--gov-accent:var(--glass-border)]',
                            unread && '[--gov-accent:var(--color-primary)]',
                            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          )}
                        >
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/60">
                            <meta.Icon aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className={cn('truncate text-sm', unread ? 'font-semibold text-foreground' : 'font-medium text-secondary-foreground')}>
                                {item.title}
                              </span>
                              {unread ? (
                                <span aria-label="未读" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                              ) : null}
                            </span>
                            {item.body ? (
                              <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-muted-foreground">
                                {item.body}
                              </span>
                            ) : null}
                            <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                              <span>{meta.label}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{formatRelativeTime(item.createdAt)}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {total > items.length ? (
              <p className="text-center text-[11px] text-muted-foreground">
                显示最近 {items.length} 条，共 {total} 条
              </p>
            ) : null}
          </div>
        )}
      </main>

      <MobileTabBar />
    </div>
  );
}
