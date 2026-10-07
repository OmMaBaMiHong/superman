'use client';

import { ExternalLink, Loader2, Pause, Play, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteFeed, exportOpml, importOpml, listFeedItems, patchFeed, type FeedListItem,
} from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { notifyFeedsChanged } from './AddSheet';

/**
 * 「我的 → 订阅」管理面板：订阅列表（暂停/恢复/删除）+ OPML 导入导出。
 * 新增订阅在「+ 添加」弹窗的订阅博主 tab；这里只管已有的。
 */
export default function SubscriptionsPanel() {
  const [feeds, setFeeds] = useState<FeedListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const opmlInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listFeedItems({ notifyOnError: false });
      setFeeds(result.items);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleEnabled = useCallback(async (feed: FeedListItem) => {
    setBusyId(feed.id);
    try {
      await patchFeed(feed.id, { enabled: !feed.enabled });
      toast.success(feed.enabled ? `已暂停采集「${feed.title}」` : `已恢复采集「${feed.title}」`);
      notifyFeedsChanged();
      await load();
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const remove = useCallback(async (feed: FeedListItem) => {
    if (!window.confirm(`确定删除订阅「${feed.title}」？其历史文章会保留。`)) return;
    setBusyId(feed.id);
    try {
      await deleteFeed(feed.id);
      toast.success(`已删除订阅「${feed.title}」`);
      notifyFeedsChanged();
      await load();
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleExport = useCallback(async () => {
    try {
      const { xml, fileName } = await exportOpml();
      const blob = new Blob([xml], { type: 'text/xml' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('已导出订阅 OPML');
    } catch {
      // apiClient 已统一 toast 错误
    }
  }, []);

  const handleImportFile = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const content = await file.text();
      const result = await importOpml({ content, fileName: file.name });
      toast.success(`导入完成：新增 ${result.importedCount} 个，跳过重复 ${result.duplicateCount} 个`);
      notifyFeedsChanged();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  }, [load]);

  return (
    <div className="space-y-3">
      {/* OPML 导入导出 */}
      <div className="flex items-center gap-2">
        <p className="flex-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          订阅源（{feeds.length}）
        </p>
        <input
          ref={opmlInputRef}
          type="file"
          accept=".xml,.opml,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => opmlInputRef.current?.click()}
          disabled={importing}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" aria-hidden="true" />}
          导入 OPML
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          导出 OPML
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-secondary/40 p-6 text-center">
          <p className="text-sm text-muted-foreground">还没有订阅源</p>
          <p className="mt-1 text-[11px] text-muted-foreground">点顶部「+ 添加」→ 订阅博主，或导入 OPML</p>
        </div>
      ) : (
        <div>
          {feeds.map((feed) => {
            const failed = Boolean(feed.lastFetchError) || (feed.lastFetchStatus !== null && feed.lastFetchStatus >= 400);
            const busy = busyId === feed.id;
            return (
              <div
                key={feed.id}
                data-testid="subscription-row"
                className="mt-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-full', feed.enabled ? (failed ? 'bg-warning' : 'bg-success') : 'bg-muted-foreground/40')}
                  title={feed.enabled ? (failed ? '采集异常' : '采集正常') : '已暂停'}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">{feed.title}</span>
                    {!feed.enabled && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">已暂停</span>
                    )}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{feed.url}</span>
                  {failed && feed.lastFetchError && (
                    <span className="block truncate text-[11px] text-warning">{feed.lastFetchError}</span>
                  )}
                </span>
                {feed.categoryTitle ? (
                  <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                    {feed.categoryTitle}
                  </span>
                ) : null}
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {feed.articleCount} 条
                </span>
                <button
                  type="button"
                  onClick={() => void toggleEnabled(feed)}
                  disabled={busy}
                  aria-label={feed.enabled ? `暂停采集 ${feed.title}` : `恢复采集 ${feed.title}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : feed.enabled ? <Pause className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
                  {feed.enabled ? '暂停' : '恢复'}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(feed)}
                  disabled={busy}
                  aria-label={`删除订阅 ${feed.title}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-error/30 px-2.5 text-xs text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  删除
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="px-1 text-[11px] text-muted-foreground">
        新增订阅在顶部「+ 添加」→ 订阅博主；暂停后不再定时抓取，历史文章保留。
      </p>
    </div>
  );
}
