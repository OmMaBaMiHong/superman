'use client';

import { useState } from 'react';
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import type { PostMetricsSnapshot, PublishedPost } from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import { formatMetric, PLATFORM_META } from '../lib/publishPlatforms';
import Sparkline from './Sparkline';

interface PostDetailViewProps {
  post: PublishedPost;
  snapshots: PostMetricsSnapshot[];
  refreshing: boolean;
  onRefresh: () => void;
  onToggleTracking: (enabled: boolean) => void;
  onDelete: () => void;
}

function formatSnapshotTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** 作品详情：7 天曲线 + 快照表 + 立即刷新 + 追踪开关 + 删除。 */
export default function PostDetailView({
  post,
  snapshots,
  refreshing,
  onRefresh,
  onToggleTracking,
  onDelete,
}: PostDetailViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const meta = PLATFORM_META[post.platform] ?? PLATFORM_META.other;
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return (
    <div className="px-5 pb-6 pt-1 sm:px-7">
      {/* 头部：平台徽章 + 标题 + 元信息 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium', meta.badgeClass)}>
          {meta.name}
        </span>
        {!meta.realData ? (
          <span className="inline-flex h-6 items-center rounded-full border border-border bg-secondary px-2 text-[11px] text-muted-foreground">
            授权后可用
          </span>
        ) : null}
      </div>

      <h2 className="mt-2.5 text-lg font-semibold leading-snug text-foreground">{post.title}</h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
        {post.accountName ? <span>{post.accountName}</span> : null}
        {post.publishedAt ? (
          <>
            <span aria-hidden="true">·</span>
            <span>发布于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(post.publishedAt))}</span>
          </>
        ) : null}
        <a
          href={post.postUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-primary transition-colors duration-150 hover:opacity-80"
        >
          查看作品
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
        </a>
      </div>

      {/* 最新指标行 */}
      {latest ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(
            [
              ['播放', latest.views],
              ['点赞', latest.likes],
              ['评论', latest.comments],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border/60 bg-secondary/40 px-3 py-2.5 text-center">
              <div className="font-mono text-lg font-semibold tabular-nums text-foreground">{formatMetric(value)}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-border px-4 py-3 text-center text-[12px] text-muted-foreground">
          还没有快照数据，点「立即刷新」抓一次。
        </p>
      )}

      {/* 7 天曲线：播放 + 点赞 */}
      <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/40 p-4">
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">7 天趋势</p>
        <Sparkline
          series={[
            { label: '播放', color: 'var(--color-primary)', values: snapshots.map((s) => s.views) },
            { label: '点赞', color: 'var(--color-warning)', values: snapshots.map((s) => s.likes) },
          ]}
        />
      </div>

      {/* 快照表 */}
      {snapshots.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border/60">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 text-right font-medium">播放</th>
                <th className="px-3 py-2 text-right font-medium">点赞</th>
                <th className="px-3 py-2 text-right font-medium">评论</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().map((snapshot) => (
                <tr key={snapshot.id} className="border-b border-border/40 last:border-b-0">
                  <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">
                    {formatSnapshotTime(snapshot.fetchedAt)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatMetric(snapshot.views)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatMetric(snapshot.likes)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatMetric(snapshot.comments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 操作行：刷新 / 追踪开关 / 删除 */}
      <div className="sticky bottom-0 -mx-1 mt-5 flex items-center justify-between gap-2 border-t border-border/60 px-1 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4',
              'text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <RefreshCw aria-hidden="true" className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            {refreshing ? '抓取中…' : '立即刷新'}
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={post.trackingEnabled}
            aria-label="追踪开关"
            onClick={() => onToggleTracking(!post.trackingEnabled)}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              post.trackingEnabled ? 'bg-success/70' : 'bg-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform duration-150',
                'h-[18px] w-[18px]',
                post.trackingEnabled ? 'translate-x-[24px]' : 'translate-x-[3px]',
              )}
            />
          </button>
          <span className="text-[11px] text-muted-foreground">{post.trackingEnabled ? '追踪中' : '已暂停'}</span>
        </div>

        {confirmingDelete ? (
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-error">确认删除？</span>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete();
              }}
              className="inline-flex h-9 items-center rounded-full border border-error/40 bg-error/10 px-3 text-xs font-medium text-error transition-colors duration-150 hover:bg-error/20"
            >
              确认
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs text-muted-foreground"
            >
              取消
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="删除作品"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-error/30 text-error/80 transition-colors duration-150 hover:bg-error/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
