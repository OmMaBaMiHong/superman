'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  ChevronDown,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  Square,
  Star,
  ThumbsUp,
  TrendingUp,
  User as UserIcon,
  Video as VideoIcon,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/features/toast/toast';
import {
  createDouyinCampaign,
  fetchCampaigns,
  fetchCampaignStatus,
  fetchDouyinComments,
  fetchDouyinOverview,
  fetchDouyinStatus,
  fetchMyWorks,
  fetchUserDouyinVideos,
  refreshDouyinVideo,
  refreshMyWorks,
  replyDouyinComment,
  runCampaignAction,
  type DouyinAuthor,
  type DouyinBridgeStatus,
  type DouyinCampaign,
  type DouyinCampaignStatus,
  type DouyinComment,
  type DouyinOverview,
  type DouyinWork,
  type MyWorksSummary,
} from '../lib/douyinApi';

type RepliedFilter = 'all' | 'pending' | 'replied';

const REPLIED_OPTIONS: [RepliedFilter, string][] = [
  ['all', '全部'],
  ['pending', '待回复'],
  ['replied', '已回复'],
];

const SENTIMENT_META: Record<string, { label: string; color: string }> = {
  positive: { label: '正面', color: '#4caf50' },
  neutral: { label: '中性', color: '#ffb300' },
  negative: { label: '负面', color: '#ef5350' },
};

function formatCommentTime(createdAt: number | null, firstSeen: number | null): string {
  const ts = firstSeen ?? (createdAt ? createdAt * 1000 : null);
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ──────────── 工具组件 ──────────── */

/** 情感环形图 */
function SentimentDonut({ overview }: { overview: DouyinOverview }) {
  const total = overview.sentiment.reduce((sum, s) => sum + s.count, 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = ['positive', 'neutral', 'negative']
    .map((key) => {
      const item = overview.sentiment.find((s) => s.sentiment === key);
      const meta = SENTIMENT_META[key];
      const count = item?.count ?? 0;
      const frac = total > 0 ? count / total : 0;
      const dash = frac * circumference;
      const seg = { key, ...meta, count, frac, dash, offset };
      offset += dash;
      return seg;
    })
    .filter((s) => s.dash > 0);
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f2f4" strokeWidth="14" />
        {segments.map((s) => (
          <circle
            key={s.key}
            cx="60" cy="60" r={radius} fill="none" stroke={s.color} strokeWidth="14"
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset} transform="rotate(-90 60 60)"
          />
        ))}
        <text x="60" y="58" textAnchor="middle" className="fill-foreground text-[22px] font-semibold">{total}</text>
        <text x="60" y="76" textAnchor="middle" className="fill-muted-foreground text-[10px]">已分析</text>
      </svg>
      <ul className="flex flex-col gap-2">
        {['positive', 'neutral', 'negative'].map((key) => {
          const meta = SENTIMENT_META[key];
          const count = overview.sentiment.find((s) => s.sentiment === key)?.count ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <li key={key} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
              <span className="w-8 text-muted-foreground">{meta.label}</span>
              <span className="font-medium text-foreground">{count}</span>
              <span className="text-xs text-muted-foreground">({pct}%)</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 评论趋势柱状图 */
function TrendBars({ overview }: { overview: DouyinOverview }) {
  const max = Math.max(1, ...overview.trend.map((t) => t.count));
  const barW = 600 / overview.trend.length;
  return (
    <svg viewBox="0 0 600 150" className="w-full">
      {overview.trend.map((t, i) => {
        const h = (t.count / max) * 90;
        const x = i * barW + barW * 0.2;
        const w = barW * 0.6;
        const showLabel = i % Math.ceil(overview.trend.length / 7) === 0;
        return (
          <g key={t.day}>
            <rect x={x} y={140 - h} width={w} height={Math.max(h, t.count > 0 ? 2 : 1)} rx="2"
              fill={t.count > 0 ? 'var(--color-primary)' : '#e6e8eb'} opacity={t.count > 0 ? 0.85 : 1} />
            {showLabel && (
              <text x={x + w / 2} y={150} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {t.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatPublishTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDuration(ms: number): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** 作品统计行 */
function WorkStats({ stats }: { stats: DouyinWork['stats'] }) {
  const items: { icon: typeof Play; label: string; value: number }[] = [
    { icon: Play, label: '播放', value: stats.plays },
    { icon: ThumbsUp, label: '点赞', value: stats.likes },
    { icon: MessageSquare, label: '评论', value: stats.comments },
    { icon: Share2, label: '分享', value: stats.shares },
    { icon: Star, label: '收藏', value: stats.collects },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1 text-xs text-muted-foreground">
          <it.icon className="h-3 w-3" />
          {fmtNum(it.value)}
        </span>
      ))}
    </div>
  );
}

/** 播放趋势迷你柱状图 */
function PlaysTrend({ items }: { items: DouyinWork[] }) {
  const sorted = [...items].filter((it) => it.time > 0).sort((a, b) => a.time - b.time);
  const max = Math.max(1, ...sorted.map((it) => it.stats.plays));
  const w = 600 / Math.max(1, sorted.length);
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5" />
        播放趋势（按发布时间排序）
      </p>
      <svg viewBox="0 0 600 120" className="w-full">
        {sorted.map((it, i) => {
          const h = (it.stats.plays / max) * 80;
          const x = i * w + w * 0.15;
          return (
            <g key={it.awemeId}>
              <rect x={x} y={100 - h} width={w * 0.7} height={Math.max(h, it.stats.plays > 0 ? 2 : 1)} rx="2"
                fill={it.stats.plays > 0 ? 'var(--color-primary)' : '#e6e8eb'} opacity={0.85}>
                <title>{`${it.title || it.awemeId} · ${fmtNum(it.stats.plays)} 播放`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ──────────── 主组件 ──────────── */

export default function DouyinDataSection() {
  // ---- 我的作品（RSSHub 订阅 articles） ----
  const [myVideoLoading, setMyVideoLoading] = useState(false);
  const [myVideos, setMyVideos] = useState<DouyinWork[]>([]);
  const [myWorksSummary, setMyWorksSummary] = useState<MyWorksSummary | null>(null);

  // ---- 选中作品详情 ----
  const [selectedWork, setSelectedWork] = useState<DouyinWork | null>(null);
  const [selectedComments, setSelectedComments] = useState<DouyinComment[]>([]);
  const [selectedCommentTotal, setSelectedCommentTotal] = useState(0);
  const [repliedFilter, setRepliedFilter] = useState<RepliedFilter>('all');
  const [page, setPage] = useState(1);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // ---- 回复 ----
  const [replyTarget, setReplyTarget] = useState<DouyinComment | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  // ---- 评论总览 ----
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overview, setOverview] = useState<DouyinOverview | null>(null);

  // ---- 桥接状态 ----
  const [bridgeStatus, setBridgeStatus] = useState<DouyinBridgeStatus | null>(null);

  // ---- 搜索用户 ----
  const [searchTarget, setSearchTarget] = useState('');
  const [userSearching, setUserSearching] = useState(false);
  const [userSearchResult, setUserSearchResult] = useState<{
    user: DouyinAuthor; items: DouyinWork[];
  } | null>(null);

  // 作品汇总（后端从订阅 articles 聚合，含总数/总播放/总点赞等）
  const worksOverview = myWorksSummary && myVideos.length > 0 ? myWorksSummary : null;

  // ---- 从 RSSHub 订阅读取我的作品（无需浏览器） ----
  const loadMyWorks = useCallback(async () => {
    setMyVideoLoading(true);
    try {
      const data = await fetchMyWorks();
      setMyVideos(data.items);
      setMyWorksSummary(data.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取作品失败', { dedupeKey: 'dy-my-works-err' });
    } finally {
      setMyVideoLoading(false);
    }
  }, []);

  // ---- 强制刷新「我的作品」订阅 ----
  const handleFetchMyVideos = useCallback(async () => {
    setMyVideoLoading(true);
    try {
      const result = await refreshMyWorks();
      if (result.refreshed) {
        toast.success('刷新任务已提交，稍后自动更新', { dedupeKey: 'dy-my-works-refresh' });
      } else if (result.reason === 'not_subscribed') {
        toast.error('还没有你的抖音主页订阅，请先在「订阅管理」添加', { dedupeKey: 'dy-my-works-nosub' });
      }
      // 重新读取最新落库数据
      const data = await fetchMyWorks();
      setMyVideos(data.items);
      setMyWorksSummary(data.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刷新失败', { dedupeKey: 'dy-my-works-err' });
    } finally {
      setMyVideoLoading(false);
    }
  }, []);

  // 首次进入自动读取订阅数据
  useEffect(() => {
    void loadMyWorks();
  }, [loadMyWorks]);

  // ---- 加载选中作品的评论 ----
  const loadComments = useCallback(async (awemeId: string) => {
    try {
      const data = await fetchDouyinComments({
        awemeId,
        replied: repliedFilter === 'all' ? undefined : repliedFilter === 'replied',
        page,
        limit: 50,
      });
      setSelectedComments(data.items);
      setSelectedCommentTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载评论失败');
    }
  }, [repliedFilter, page]);

  // 选中作品时自动加载评论
  useEffect(() => {
    if (selectedWork) void loadComments(selectedWork.awemeId);
  }, [selectedWork, loadComments]);

  // ---- 抓评论 ----
  const handleRefresh = useCallback(async (awemeId: string) => {
    if (refreshingId) return;
    setRefreshingId(awemeId);
    try {
      const { count } = await refreshDouyinVideo(awemeId);
      toast.success(count > 0 ? `已抓取 ${count} 条新评论` : '没有新的评论', { dedupeKey: `dy-refresh-${awemeId}` });
      if (selectedWork?.awemeId === awemeId) void loadComments(awemeId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '抓取失败', { dedupeKey: `dy-refresh-err-${awemeId}` });
    } finally {
      setRefreshingId(null);
    }
  }, [refreshingId, selectedWork, loadComments]);

  // ---- 回复 ----
  const handleReply = useCallback(async (comment: DouyinComment) => {
    const text = replyText.trim();
    if (!text) { toast.error('请输入回复内容'); return; }
    setReplying(true);
    try {
      await replyDouyinComment(comment.cid, comment.awemeId, text);
      toast.success('回复已发布', { dedupeKey: `dy-reply-${comment.cid}` });
      setReplyTarget(null);
      setReplyText('');
      if (selectedWork) void loadComments(selectedWork.awemeId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回复失败', { dedupeKey: `dy-reply-err-${comment.cid}` });
    } finally {
      setReplying(false);
    }
  }, [replyText, selectedWork, loadComments]);

  // ---- 搜索用户 ----
  const handleSearchUser = useCallback(async () => {
    const target = searchTarget.trim();
    if (!target) { toast.error('请输入 sec_user_id 或主页 URL'); return; }
    setUserSearching(true);
    setUserSearchResult(null);
    try {
      const result = await fetchUserDouyinVideos(target, 18);
      setUserSearchResult(result);
      toast.success(`已拉取 ${result.items.length} 条作品`, { dedupeKey: 'dy-user-search' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '拉取用户作品失败', { dedupeKey: 'dy-user-search-err' });
    } finally {
      setUserSearching(false);
    }
  }, [searchTarget]);

  // ---- 加载评论总览 ----
  useEffect(() => {
    const load = async () => {
      try {
        const ov = await fetchDouyinOverview();
        setOverview(ov);
      } catch { /* 静默 */ } finally {
        setOverviewLoading(false);
      }
    };
    void load();
  }, []);

  // ---- 轮询桥接状态 ----
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const status = await fetchDouyinStatus();
        if (alive) setBridgeStatus(status);
      } catch { /* 静默 */ }
    };
    void check();
    const timer = setInterval(check, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const totalPages = Math.max(1, Math.ceil(selectedCommentTotal / 50));

  return (
    <section className="flex flex-col gap-6" data-testid="douyin-data-section">
      {/* 桥接状态提示 */}
      {bridgeStatus && !bridgeStatus.connected && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">浏览器未连接油猴脚本</p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
              {bridgeStatus.error === 'Bridge Server 未启动'
                ? '请先在 douyin-cli 目录运行 node server.js 启动 Bridge Server。'
                : '请打开抖音页面并保持登录，确认右上角油猴脚本已运行。'}
              「搜索用户 / 抓评论 / 在线回复」需要浏览器在线；「我的作品」走 RSSHub 订阅，无需浏览器。
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════ 区域一：我的作品 ═══════════════ */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <VideoIcon className="h-4 w-4" />
            我的作品
          </h2>
          <Button variant="outline" size="sm" onClick={handleFetchMyVideos} disabled={myVideoLoading}>
            {myVideoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {myVideoLoading ? '刷新中…' : '刷新订阅'}
          </Button>
        </div>

        {myVideoLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />正在读取订阅数据…
          </div>
        ) : myVideos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
            <p className="mb-2">还没有「我的作品」数据。</p>
            <p>请在订阅管理中把你的抖音主页添加为 RSSHub 订阅（douyin/user），再点「刷新订阅」获取作品列表。</p>
          </div>
        ) : (
          <>
            {/* 作品汇总仪表盘 */}
            {worksOverview && (
              <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                <WorkStatCard label="作品数" value={worksOverview.total} />
                <WorkStatCard label="总播放" value={worksOverview.totalPlays} />
                <WorkStatCard label="总点赞" value={worksOverview.totalLikes} />
                <WorkStatCard label="总评论" value={worksOverview.totalComments} />
                <WorkStatCard label="总分享" value={worksOverview.totalShares} />
                <WorkStatCard label="总收藏" value={worksOverview.totalCollects} />
              </div>
            )}

            {/* 播放趋势 */}
            <PlaysTrend items={myVideos} />

            {/* 作品列表（订阅样式） */}
            <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/80">
              {myVideos.map((it) => {
                const active = selectedWork?.awemeId === it.awemeId;
                return (
                  <li key={it.awemeId} className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWork(active ? null : it);
                        setPage(1);
                        setRepliedFilter('all');
                      }}
                      className="flex w-full min-w-0 items-start gap-3 text-left"
                    >
                      <span className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                        active
                          ? 'border-primary/40 bg-[color-mix(in_oklab,var(--color-primary)_10%,transparent)] text-primary'
                          : 'border-border/80 bg-muted/40 text-muted-foreground',
                      )}>
                        <VideoIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {it.title || `视频 ${it.awemeId}`}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatPublishTime(it.time)}
                            {it.duration ? ` · ${formatDuration(it.duration)}` : ''}
                          </span>
                        </div>
                        <WorkStats stats={it.stats} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* ═══════════════ 区域二：作品详情（选中后显示） ═══════════════ */}
      {selectedWork && (
        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <VideoIcon className="h-4 w-4" />
            作品详情
          </h2>

          {/* 单个作品统计卡片 */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <WorkStatCard label="播放" value={selectedWork.stats.plays} />
            <WorkStatCard label="点赞" value={selectedWork.stats.likes} accent />
            <WorkStatCard label="评论" value={selectedWork.stats.comments} />
            <WorkStatCard label="分享" value={selectedWork.stats.shares} />
            <WorkStatCard label="收藏" value={selectedWork.stats.collects} />
            <div className="rounded-xl border border-border/80 bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">发布时间</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
                {formatPublishTime(selectedWork.time)}
              </p>
            </div>
          </div>

          {/* 该作品的评论列表 */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-foreground">
                评论
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  （共 {selectedCommentTotal} 条）
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {REPLIED_OPTIONS.map(([key, label]) => (
                    <button
                      key={key} type="button"
                      onClick={() => { setRepliedFilter(key); setPage(1); }}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        repliedFilter === key
                          ? 'border-primary bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-primary'
                          : 'border-border/80 text-muted-foreground hover:text-foreground',
                      )}
                    >{label}</button>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={() => handleRefresh(selectedWork.awemeId)} disabled={refreshingId !== null}>
                  {refreshingId === selectedWork.awemeId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {refreshingId === selectedWork.awemeId ? '抓取中…' : '抓评论'}
                </Button>
              </div>
            </div>

            {selectedComments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 px-4 py-6 text-center text-sm text-muted-foreground">
                该作品还没有评论，点「抓评论」拉取最新数据。
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/80">
                {selectedComments.map((comment) => {
                  const meta = comment.sentiment ? SENTIMENT_META[comment.sentiment] : null;
                  const isReplying = replyTarget?.cid === comment.cid;
                  return (
                    <li key={comment.cid} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/40 text-xs font-medium text-muted-foreground">
                            {(comment.nickname || '?').slice(0, 1)}
                          </span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium text-foreground">{comment.nickname || '未知用户'}</span>
                              {meta && <span className="rounded-full px-1.5 py-0.5 text-[10px] text-white" style={{ background: meta.color }}>{meta.label}</span>}
                              {comment.replied && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">已回复</span>}
                              <span className="text-muted-foreground">{formatCommentTime(comment.createdAt, comment.firstSeen)}</span>
                              {comment.digg != null && comment.digg > 0 && <span className="text-muted-foreground">👍 {comment.digg}</span>}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{comment.text}</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => { setReplyTarget(isReplying ? null : comment); setReplyText(''); }} disabled={isReplying}>
                          <Send className="h-3.5 w-3.5" />{comment.replied ? '再回复' : '回复'}
                        </Button>
                      </div>
                      {isReplying && (
                        <div className="ml-11 flex flex-col gap-2">
                          <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={3}
                            placeholder="输入回复内容…（将通过油猴脚本在浏览器发布）"
                            className="w-full resize-y rounded-lg border border-border/80 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                          />
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => { setReplyTarget(null); setReplyText(''); }}>取消</Button>
                            <Button size="sm" onClick={() => handleReply(comment)} disabled={replying || !replyText.trim()}>
                              {replying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                              发布回复
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            <MessageSquare className="mr-1 inline h-3 w-3" />需要浏览器保持抖音页面在线。
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {selectedCommentTotal > 50 && (
              <div className="flex items-center justify-center gap-2 text-sm">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <span className="text-muted-foreground">{page} / {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ 区域三：评论总览 ═══════════════ */}
      {overview && (
        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <MessageSquare className="h-4 w-4" />
            评论总览
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="评论总数" value={overview.total} />
            <StatCard label="待回复" value={overview.pending} accent />
            <StatCard label="已回复" value={overview.replied} />
            <StatCard label="今日新增" value={overview.todayNew} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/80 bg-background p-4">
              <h3 className="mb-3 text-sm font-medium text-foreground">情感分布</h3>
              {overviewLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />加载中…
                </div>
              ) : (
                <SentimentDonut overview={overview} />
              )}
            </div>
            <div className="rounded-xl border border-border/80 bg-background p-4">
              <h3 className="mb-3 text-sm font-medium text-foreground">评论趋势（近 14 天）</h3>
              {overviewLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />加载中…
                </div>
              ) : (
                <TrendBars overview={overview} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ 自动回帖（campaign） ═══════════════ */}
      <CampaignSection myVideos={myVideos} />

      {/* ═══════════════ 区域四：搜索用户分析 ═══════════════ */}
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <UserIcon className="h-4 w-4" />
          搜索用户分析
        </h2>
        <div className="rounded-xl border border-border/80 bg-background p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={searchTarget}
              onChange={(e) => setSearchTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearchUser(); }}
              placeholder="输入 sec_user_id 或用户主页 URL（https://www.douyin.com/user/…）"
              className="h-8 min-w-0 flex-1 rounded-lg border border-border/80 bg-background px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />
            <Button variant="outline" size="sm" onClick={handleSearchUser} disabled={userSearching}>
              {userSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {userSearching ? '分析中…' : '搜索分析'}
            </Button>
          </div>
          {userSearching ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />正在拉取该用户的作品…
            </div>
          ) : userSearchResult ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                用户：<span className="font-medium text-foreground">{userSearchResult.user.nickname || '未知'}</span>
                {userSearchResult.user.uid ? `（uid: ${userSearchResult.user.uid}）` : ''} · 共 {userSearchResult.items.length} 条作品
              </p>
              <PlaysTrend items={userSearchResult.items} />
              <WorkList items={userSearchResult.items} />
            </div>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              输入其他博主的 sec_user_id 或主页链接，拉取其作品进行数据分析（需浏览器在线）。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ──────────── 子组件 ──────────── */

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border/80 bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', accent ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
        {value}
      </p>
    </div>
  );
}

function WorkStatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border/80 bg-background px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold tabular-nums', accent ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
        {fmtNum(value)}
      </p>
    </div>
  );
}

function WorkList({ items }: { items: DouyinWork[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/80">
      {items.map((it) => (
        <li key={it.awemeId} className="flex flex-col gap-1.5 px-4 py-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-foreground" title={it.title}>
              {it.title || `视频 ${it.awemeId}`}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatPublishTime(it.time)}
              {it.duration ? ` · ${formatDuration(it.duration)}` : ''}
            </span>
          </div>
          <WorkStats stats={it.stats} />
          <p className="truncate text-[11px] text-muted-foreground/80">{it.awemeId}</p>
        </li>
      ))}
    </ul>
  );
}

/* ──────────── 自动回帖（campaign） ──────────── */

const CAMPAIGN_STATUS_META: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  running: { label: '运行中', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  paused: { label: '已暂停', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
  done: { label: '已完成', cls: 'bg-sky-500/10 text-sky-600 dark:bg-emerald-500/10 dark:text-emerald-400', dot: 'bg-sky-500 dark:bg-emerald-400' },
};

function CampaignStatusBadge({ status, daemon }: { status: string; daemon: boolean }) {
  const meta = CAMPAIGN_STATUS_META[status] ?? CAMPAIGN_STATUS_META.draft;
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]', meta.cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', daemon ? 'animate-pulse bg-emerald-500' : meta.dot)} />
      {meta.label}
      {daemon && <span className="font-normal opacity-70">· daemon</span>}
    </span>
  );
}

/** 活动任务进度条 */
function TaskProgress({ tasks }: { tasks: DouyinCampaignStatus['tasks'] }) {
  const segs: { key: string; label: string; n: number; cls: string }[] = [
    { key: 'pending', label: '待发送', n: tasks.pending, cls: 'bg-amber-500' },
    { key: 'posted', label: '已发送', n: tasks.posted, cls: 'bg-emerald-500' },
    { key: 'failed', label: '失败', n: tasks.failed, cls: 'bg-rose-500' },
    { key: 'skipped', label: '跳过', n: tasks.skipped, cls: 'bg-border' },
  ];
  const total = Math.max(1, tasks.total);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-border/60">
        {segs.map((s) =>
          s.n > 0 ? (
            <div
              key={s.key}
              className={s.cls}
              style={{ width: `${(s.n / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {segs.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className={cn('h-1.5 w-1.5 rounded-full', s.cls)} />
            {s.label} <span className="font-medium text-foreground">{s.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 自动回帖：创建活动 + 活动列表 + 状态与操作 */
function CampaignSection({ myVideos }: { myVideos: DouyinWork[] }) {
  const [campaigns, setCampaigns] = useState<DouyinCampaign[]>([]);
  const [statusMap, setStatusMap] = useState<Record<number, DouyinCampaignStatus>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // 新建活动表单
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [manualIds, setManualIds] = useState('');
  const [dailyQuota, setDailyQuota] = useState(50);
  const [minPriority, setMinPriority] = useState(0);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const list = await fetchCampaigns();
      setCampaigns(list);
      const statuses: Record<number, DouyinCampaignStatus> = {};
      await Promise.all(
        list.map(async (c) => {
          try {
            statuses[c.id] = await fetchCampaignStatus(c.id);
          } catch { /* 单个活动状态失败不阻塞列表 */ }
        }),
      );
      setStatusMap(statuses);
    } catch (err) {
      if (!silent) {
        toast.error(err instanceof Error ? err.message : '读取自动回帖活动失败', { dedupeKey: 'dy-campaign-load' });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // 仅当有活动的 daemon 真正在跑时才轮询状态；否则只在进入时加载一次
  const needsPolling = campaigns.some((c) => statusMap[c.id]?.daemon.running);

  // 进入时加载一次（活动查询为直读库，毫秒级返回）
  useEffect(() => {
    void load();
  }, [load]);

  // 仅当有活动在跑时才轮询状态（15s），活动结束自动停止
  useEffect(() => {
    if (!needsPolling) return;
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [needsPolling, load]);

  const hasRunning = campaigns.some((c) => c.status === 'running');

  const handleAction = useCallback(async (id: number, action: string, successMsg: string) => {
    const key = `${action}:${id}`;
    if (busyAction) return;
    setBusyAction(key);
    try {
      await runCampaignAction(id, action as 'plan' | 'run' | 'stop' | 'pause' | 'resume');
      toast.success(successMsg, { dedupeKey: `dy-campaign-${key}` });
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败', { dedupeKey: `dy-campaign-err-${key}` });
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, load]);

  const handleCreate = useCallback(async () => {
    const cleanName = name.trim();
    if (!cleanName) { toast.error('请输入活动名称'); return; }
    const manual = manualIds
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
    const videos = [...new Set([...checkedIds, ...manual])];
    if (videos.length === 0) { toast.error('请至少选择一个目标视频'); return; }
    setCreating(true);
    try {
      const created = await createDouyinCampaign({
        name: cleanName,
        goal: goal.trim() || null,
        videos,
        dailyQuota,
        minPriority,
      });
      toast.success(`活动「${created.name}」已创建`, { dedupeKey: 'dy-campaign-create' });
      setShowCreate(false);
      setName(''); setGoal(''); setCheckedIds(new Set()); setManualIds('');
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建活动失败', { dedupeKey: 'dy-campaign-create-err' });
    } finally {
      setCreating(false);
    }
  }, [name, goal, manualIds, checkedIds, dailyQuota, minPriority, load]);

  const toggleVideo = useCallback((awemeId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(awemeId)) next.delete(awemeId);
      else next.add(awemeId);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-3" data-testid="douyin-campaign-section">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Bot className="h-4 w-4" />
          自动回帖
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} disabled={creating}>
            {showCreate ? <ChevronDown className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showCreate ? '收起' : '新建活动'}
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              活动名称
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：新作品评论互动"
                className="h-8 rounded-lg border border-border/80 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              目标（可选，影响 LLM 生成语气）
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="例如：product_launch / 日常互动"
                className="h-8 rounded-lg border border-border/80 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              每日配额
              <input
                type="number"
                min={1}
                max={500}
                value={dailyQuota}
                onChange={(e) => setDailyQuota(Number(e.target.value) || 1)}
                className="h-8 rounded-lg border border-border/80 bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              最低优先级（0-5，仅回复高于该值的评论）
              <input
                type="number"
                min={0}
                max={5}
                value={minPriority}
                onChange={(e) => setMinPriority(Number(e.target.value) || 0)}
                className="h-8 rounded-lg border border-border/80 bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/50"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            目标视频（勾选下方作品，或手动输入 aweme_id，逗号分隔）
            {myVideos.length > 0 && (
              <div className="mt-1 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto md:grid-cols-2">
                {myVideos.map((v) => (
                  <label key={v.awemeId} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={checkedIds.has(v.awemeId)}
                      onChange={() => toggleVideo(v.awemeId)}
                      className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 truncate text-foreground">
                      {v.title || `视频 ${v.awemeId}`}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">{v.awemeId}</span>
                  </label>
                ))}
              </div>
            )}
            <input
              value={manualIds}
              onChange={(e) => setManualIds(e.target.value)}
              placeholder="手动输入：7461234567890, 7461234567891"
              className="mt-1 h-8 rounded-lg border border-border/80 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>取消</Button>
            <Button size="sm" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              创建活动
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />正在读取自动回帖活动…
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
          <p className="mb-2">还没有自动回帖活动。</p>
          <p>
            点击「新建活动」选择目标视频，先「预生成回复」让 AI 生成回复草稿，再「启动」自动发布。
            生成与发布需要浏览器保持抖音页面在线，并已配置全局 AI 模型。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/80">
          {campaigns.map((c) => {
            const st = statusMap[c.id];
            const daemon = st?.daemon.running ?? false;
            const tasks = st?.tasks;
            const busy = busyAction?.endsWith(`:${c.id}`);
            return (
              <li key={c.id} className="flex flex-col gap-2.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  <CampaignStatusBadge status={c.status} daemon={daemon} />
                  {daemon && st?.daemon.pid != null && (
                    <span className="text-[11px] text-muted-foreground">pid {st.daemon.pid}</span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {c.videos.length} 个视频 · 日配额 {c.dailyQuota}
                    {c.filters?.minPriority ? ` · 优先级 ≥${c.filters.minPriority}` : ''}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {c.videos.map((v) => (
                    <span key={v} className="rounded-full border border-border/80 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {v}
                    </span>
                  ))}
                </div>

                {tasks && <TaskProgress tasks={tasks} />}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-[11px] text-muted-foreground">
                    评论已见 {typeof c.stats?.comments_seen === 'number' ? c.stats.comments_seen : '-'}
                    {typeof c.stats?.inserted === 'number' && ` · 已生成 ${c.stats.inserted}`}
                    {typeof c.stats?.posted === 'number' && c.stats.posted > 0 && ` · 已发送 ${c.stats.posted}`}
                    {typeof c.stats?.failed === 'number' && c.stats.failed > 0 && ` · 失败 ${c.stats.failed}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {hasRunning && c.status === 'running' && (
                      <span className="mr-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                        自动回帖中…
                      </span>
                    )}
                    <Button
                      variant="outline" size="sm"
                      disabled={busy || creating}
                      onClick={() => void handleAction(c.id, 'plan', '已提交预生成，AI 正在生成回复草稿')}
                    >
                      {busy && busyAction === `plan:${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                      预生成回复
                    </Button>
                    {c.status === 'running' ? (
                      <>
                        <Button variant="outline" size="sm" disabled={busy || creating} onClick={() => void handleAction(c.id, 'pause', '活动已暂停')}>
                          {busy && busyAction === `pause:${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                          暂停
                        </Button>
                        <Button variant="destructive" size="sm" disabled={busy || creating} onClick={() => void handleAction(c.id, 'stop', '已停止自动回帖')}>
                          {busy && busyAction === `stop:${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                          停止
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" disabled={busy || creating} onClick={() => void handleAction(c.id, 'run', '自动回帖已启动')}>
                        {busy && busyAction === `run:${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        {c.status === 'paused' ? '恢复' : '启动'}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        自动回帖流程：新建活动选择视频 → 预生成回复（AI 拉评论并生成草稿，不发送）→ 启动后台自动回帖（按日配额与风控节奏逐条发布）。
        预生成与发布均需浏览器保持抖音页面在线（油猴脚本），AI 使用「设置中心 → AI 配置」里的全局模型。
      </p>
    </div>
  );
}