'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Flame, Plus, Radio } from 'lucide-react';
import {
  deletePublishedPost,
  getPublishedPostDetail,
  listPublishedPosts,
  refreshPublishedPost,
  setPublishedPostTracking,
  type PostMetricsSnapshot,
  type PublishedPost,
  type PublishedPostListItem,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { formatDelta, formatMetric, PLATFORM_META } from '../lib/publishPlatforms';
import PostDetailView from './PostDetailView';
import PostRegisterSheet from './PostRegisterSheet';

const POLL_MS = 60_000;

function PostCard({ post, onOpen }: { post: PublishedPostListItem; onOpen: () => void }) {
  const meta = PLATFORM_META[post.platform] ?? PLATFORM_META.other;
  const snapshot = post.latestSnapshot;
  const viewsDelta = formatDelta(post.delta24h?.views ?? null);
  const stubLocked = !meta.realData;

  return (
    <button
      type="button"
      data-testid="post-card"
      data-hot={post.hot}
      onClick={onOpen}
      className={cn(
        'gov-card flex w-full flex-col gap-2.5 p-4 text-left [--gov-accent:var(--glass-border)]',
        post.hot && '[--gov-accent:var(--color-warning)]',
        stubLocked && 'opacity-70',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
    >
      {/* hot 提示条（仅有关联选题时提示已送回审批台） */}
      {post.hot && post.articleId ? (
        <div
          data-testid="hot-banner"
          className="flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] font-medium text-warning"
        >
          <Flame aria-hidden="true" className="h-3 w-3 shrink-0" />
          数据起飞，原选题已送回审批台
        </div>
      ) : null}

      <div className="flex items-center gap-1.5">
        <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium', meta.badgeClass)}>
          {meta.name}
        </span>
        {post.hot ? (
          <span
            title={post.hotReasons.join('；') || '数据起飞'}
            className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border border-warning/40 bg-warning/10 px-1.5 text-[10px] font-medium text-warning"
          >
            <Flame aria-hidden="true" className="h-2.5 w-2.5" />
            火了
          </span>
        ) : null}
        {stubLocked ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-secondary px-1.5 text-[10px] text-muted-foreground">
            授权后可用
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {post.publishedAt
            ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(post.publishedAt))
            : ''}
        </span>
      </div>

      <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">{post.title}</h3>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {post.accountName ? <span className="truncate">{post.accountName}</span> : null}
        <a
          href={post.postUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-primary/80 transition-colors hover:text-primary"
          aria-label="查看作品链接"
        >
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
        </a>
        {!post.trackingEnabled ? <span className="text-muted-foreground/70">· 追踪已暂停</span> : null}
      </div>

      {/* 核心指标行：播放/点赞/评论 + 24h 增量 */}
      {snapshot ? (
        <div className="flex items-end justify-between gap-2 border-t border-border/60 pt-2.5">
          <div className="flex items-center gap-4">
            {(
              [
                ['播放', snapshot.views],
                ['点赞', snapshot.likes],
                ['评论', snapshot.comments],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className="font-mono text-base font-semibold tabular-nums text-foreground">{formatMetric(value)}</div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="text-right">
            <div
              className={cn(
                'font-mono text-sm font-semibold tabular-nums',
                viewsDelta.tone === 'up' ? 'text-success' : viewsDelta.tone === 'down' ? 'text-muted-foreground' : 'text-muted-foreground',
              )}
            >
              {viewsDelta.text}
            </div>
            <div className="text-[10px] text-muted-foreground">24h 播放</div>
          </div>
        </div>
      ) : (
        <p className="border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
          {stubLocked ? '该平台的真实数据等授权中心接入。' : '还没有快照，打开详情点「立即刷新」。'}
        </p>
      )}
    </button>
  );
}

/** 创作台「表现」分区：作品列表 + 登记 + 详情。 */
export default function PerformanceSection() {
  const [posts, setPosts] = useState<PublishedPostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [detailPost, setDetailPost] = useState<PublishedPost | null>(null);
  const [detailSnapshots, setDetailSnapshots] = useState<PostMetricsSnapshot[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await listPublishedPosts({ notifyOnError: false });
      setPosts(result.items);
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

  const loadDetail = useCallback(async (id: string) => {
    try {
      const result = await getPublishedPostDetail(id, { notifyOnError: false });
      setDetailPost(result.post);
      setDetailSnapshots(result.snapshots);
    } catch {
      // 静默
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetail = useCallback(
    (post: PublishedPostListItem) => {
      setDetailPost(post);
      setDetailSnapshots([]);
      setDetailLoading(true);
      void loadDetail(post.id);
    },
    [loadDetail],
  );

  const closeDetail = useCallback(() => {
    setDetailPost(null);
    setDetailSnapshots([]);
  }, []);

  const handleRefresh = useCallback(() => {
    if (!detailPost || refreshing) return;
    setRefreshing(true);
    void refreshPublishedPost(detailPost.id)
      .then(() => Promise.all([loadDetail(detailPost.id), load(true)]))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [detailPost, refreshing, loadDetail, load]);

  const handleToggleTracking = useCallback(
    (enabled: boolean) => {
      if (!detailPost) return;
      void setPublishedPostTracking(detailPost.id, enabled)
        .then(({ post }) => {
          setDetailPost(post);
          void load(true);
          toast.success(enabled ? '追踪已开启' : '追踪已暂停');
        })
        .catch(() => {});
    },
    [detailPost, load],
  );

  const handleDelete = useCallback(() => {
    if (!detailPost) return;
    void deletePublishedPost(detailPost.id)
      .then(() => {
        toast.success('已删除');
        closeDetail();
        void load(true);
      })
      .catch(() => {});
  }, [detailPost, closeDetail, load]);

  return (
    <section aria-label="表现">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          发布后作品的数据追踪（播放/点赞/评论，7 天曲线）
        </p>
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className={cn(
            'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 sm:h-9',
            'text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          登记作品
        </button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="gov-card h-44 animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
          <Radio aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">还没有登记作品</p>
          <p className="mt-2 text-xs text-muted-foreground">
            发布后贴个链接就能追踪表现。
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onOpen={() => openDetail(post)} />
          ))}
        </div>
      )}

      <PostRegisterSheet
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onRegistered={() => void load(true)}
      />

      <GlassDetailSheet
        open={detailPost !== null}
        onClose={closeDetail}
        ariaLabel={detailPost ? `作品详情：${detailPost.title}` : '作品详情'}
      >
        {detailPost ? (
          detailLoading ? (
            <div className="space-y-3 px-5 pb-10 pt-2 sm:px-7" aria-busy="true">
              <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
              <div className="h-7 w-4/5 animate-pulse rounded-lg bg-muted" />
              <div className="h-40 animate-pulse rounded-2xl bg-muted" />
            </div>
          ) : (
            <PostDetailView
              post={detailPost}
              snapshots={detailSnapshots}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onToggleTracking={handleToggleTracking}
              onDelete={handleDelete}
            />
          )
        ) : null}
      </GlassDetailSheet>
    </section>
  );
}
