'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Clock, Loader2, MessageSquare } from 'lucide-react';
import { parseDouyinStatsFromHtml } from '@/lib/douyin/stats';

interface DouyinComment {
  cid: string;
  awemeId: string;
  nickname: string | null;
  text: string | null;
  digg: number | null;
  createdAt: number | null;
  firstSeen: number | null;
  sentiment: string | null;
  replied: boolean;
}

interface DouyinVideoStatsProps {
  contentHtml: string;
  articleId: string | null;
}

const SENTIMENT_META: Record<string, { label: string; color: string }> = {
  positive: { label: '正面', color: '#4caf50' },
  neutral: { label: '中性', color: '#ffb300' },
  negative: { label: '负面', color: '#ef5350' },
};

function fmtNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatPublishTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatCommentTime(createdAt: number | null, firstSeen: number | null): string {
  const ts = firstSeen ?? (createdAt ? createdAt * 1000 : null);
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 视频详情页 · 抖音数据统计仪表盘（平铺）
 *
 * 仅当文章 content 里存在 RSSHub 注入的 data-douyin-stats 时渲染，
 * 其他平台（B站/YouTube 等）无该标记，自动不显示。
 * 统计数字直接解析自文章内容；评论列表读 douyin.comments 表（需已抓取）。
 */
export default function DouyinVideoStats({ contentHtml, articleId }: DouyinVideoStatsProps) {
  const stats = useMemo(() => parseDouyinStatsFromHtml(contentHtml), [contentHtml]);

  const [comments, setComments] = useState<DouyinComment[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);

  useEffect(() => {
    if (!stats) return;
    let alive = true;
    setCommentsLoading(true);
    setCommentsLoaded(false);
    const q = new URLSearchParams({ awemeId: stats.awemeId, limit: '20' });
    fetch(`/api/workspace/douyin/comments?${q.toString()}`, {
      headers: { accept: 'application/json' },
    })
      .then((res) => res.json())
      .then((payload: { ok?: boolean; data?: { items?: DouyinComment[]; total?: number } }) => {
        if (!alive) return;
        if (payload?.ok) {
          setComments(payload.data?.items ?? []);
          setCommentsTotal(payload.data?.total ?? 0);
        }
      })
      .catch(() => {
        // 静默：评论抓取失败不影响统计展示
      })
      .finally(() => {
        if (alive) {
          setCommentsLoading(false);
          setCommentsLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [stats]);

  if (!stats) return null;

  const statItems: { key: string; label: string; value: number }[] = [
    { key: 'plays', label: '播放', value: stats.stats.plays },
    { key: 'likes', label: '点赞', value: stats.stats.likes },
    { key: 'comments', label: '评论', value: stats.stats.comments },
    { key: 'shares', label: '分享', value: stats.stats.shares },
    { key: 'collects', label: '收藏', value: stats.stats.collects },
  ];

  return (
    <section
      data-testid="douyin-video-stats"
      className="mb-5 overflow-hidden rounded-2xl border border-border/70 bg-card/70"
      aria-label="抖音数据统计"
    >
      {/* 标题行 */}
      <div className="flex items-center gap-1.5 px-4 pt-3">
        <BarChart3 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-foreground">数据统计</span>
        {articleId ? (
          <button
            type="button"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('view', 'publish-center');
              url.searchParams.delete('article');
              window.location.href = url.toString();
            }}
            className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            前往工作台
          </button>
        ) : null}
      </div>

      {/* 平铺统计条 */}
      <div className="mt-2 grid grid-cols-3 divide-x divide-border/70 border-y border-border/70 md:grid-cols-7">
        {statItems.map((it) => (
          <div key={it.key} className="flex flex-col items-center gap-0.5 px-2 py-3">
            <span className="text-base font-semibold tabular-nums text-foreground">{fmtNum(it.value)}</span>
            <span className="text-[11px] text-muted-foreground">{it.label}</span>
          </div>
        ))}
        <div className="flex flex-col items-center gap-0.5 px-2 py-3">
          <span className="flex items-center gap-1 text-base font-semibold tabular-nums text-foreground">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDuration(stats.duration) || '--'}
          </span>
          <span className="text-[11px] text-muted-foreground">时长</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-2 py-3">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatPublishTime(stats.createTime) || '--'}
          </span>
          <span className="text-[11px] text-muted-foreground">发布时间</span>
        </div>
      </div>

      {/* 评论列表 */}
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-medium text-foreground">
            评论
            {commentsLoaded && commentsTotal > 0 ? (
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">（共 {commentsTotal} 条）</span>
            ) : null}
          </span>
        </div>

        {commentsLoading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />加载评论…
          </div>
        ) : comments.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            尚未抓取该作品的评论，可到工作台「抖音数据」中抓取后回来看。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {comments.map((comment) => {
              const meta = comment.sentiment ? SENTIMENT_META[comment.sentiment] : null;
              return (
                <li key={comment.cid} className="flex items-start gap-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/40 text-[11px] font-medium text-muted-foreground">
                    {(comment.nickname || '?').slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-medium text-foreground">{comment.nickname || '未知用户'}</span>
                      {meta && (
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] text-white" style={{ background: meta.color }}>
                          {meta.label}
                        </span>
                      )}
                      {comment.replied && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                          已回复
                        </span>
                      )}
                      <span className="text-muted-foreground">{formatCommentTime(comment.createdAt, comment.firstSeen)}</span>
                      {comment.digg != null && comment.digg > 0 && <span className="text-muted-foreground">👍 {comment.digg}</span>}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">
                      {comment.text}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
