'use client';

/**
 * 我的数据 —— 自己作品的流量/受众分析（ProfilePage「数据」子Tab）。
 * 数据：GET /s/api/me/data/overview（平台合计 + 14 天趋势 + 作品列表 + 受众）。
 * 平台 Tab = 已登记作品里出现过的平台；每个 Tab 一份作品列表。
 * AI 建议：POST /s/api/me/data/advice（DSH 宿主模型，点按钮触发生成）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Eye, Heart, Loader2, MessageCircle, RefreshCw, Share2, Sparkles, User,
} from 'lucide-react';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { apiFetch } from '../lib/auth';

interface PlatformTotals { platform: string; posts: number; views: number; likes: number; comments: number; shares: number }
interface SeriesPoint { day: string; views: number; likes: number; comments: number }
interface WorkRow {
  postId: number; platform: string; title: string; postUrl: string;
  publishedAt: string | null; views: number | null; likes: number | null;
  comments: number | null; shares: number | null; fetchedAt: string | null;
}
interface Overview {
  totals: { posts: number; views: number; likes: number; comments: number; shares: number };
  platforms: PlatformTotals[];
  series: SeriesPoint[];
  works: WorkRow[];
  audience: {
    totalComments: number;
    topCommenters: Array<{ author: string; cnt: number; likes: number; ipLocation: string | null }>;
    ipLocations: Array<{ loc: string; cnt: number }>;
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  douyin: '抖音', xhs: '小红书', bilibili: 'B站', wechat: '视频号', other: '其他',
};

function compact(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function dayLabel(iso: string): string {
  return iso.slice(5); // MM-dd
}

/** 14 天播放趋势（纯 SVG 折线 + 渐变面积）。 */
function TrendChart({ series }: { series: SeriesPoint[] }) {
  const { path, area, max, points } = useMemo(() => {
    const W = 320;
    const H = 88;
    const pad = 4;
    const values = series.map((p) => p.views);
    const max = Math.max(...values, 1);
    const stepX = series.length > 1 ? (W - pad * 2) / (series.length - 1) : 0;
    const points = series.map((p, i) => {
      const x = pad + i * stepX;
      const y = H - pad - (p.views / max) * (H - pad * 2);
      return [x, y] as const;
    });
    const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = points.length > 0
      ? `${path} L${points[points.length - 1][0].toFixed(1)},${H - pad} L${points[0][0].toFixed(1)},${H - pad} Z`
      : '';
    return { path, area, max, points };
  }, [series]);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">近 {series.length} 天播放趋势</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">峰值 {compact(max)}</span>
      </div>
      <svg viewBox="0 0 320 88" className="mt-1.5 h-22 w-full" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="mydata-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {area ? <path d={area} fill="url(#mydata-trend-fill)" className="text-primary" /> : null}
        {points.length > 1 ? (
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" className="text-primary" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
      </svg>
      <div className="flex justify-between font-mono text-[9px] tabular-nums text-muted-foreground">
        <span>{series[0] ? dayLabel(series[0].day) : ''}</span>
        <span>{series[series.length - 1] ? dayLabel(series[series.length - 1].day) : ''}</span>
      </div>
    </div>
  );
}

function MetricTile({ Icon, label, value, tint }: { Icon: typeof Eye; label: string; value: string; tint: string }) {
  return (
    <div className="glass-surface flex flex-col items-center rounded-2xl px-2 py-3">
      <Icon className={cn('h-4 w-4', tint)} aria-hidden="true" />
      <span className="mt-1 text-base font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export default function MyDataPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<string>('all');
  const [advice, setAdvice] = useState('');
  const [adviceLoading, setAdviceLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/s/api/me/data/overview');
      const json = await res.json();
      if (json.ok) setData(json.data as Overview);
    } catch {
      // 静默：保留旧数据
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const makeAdvice = useCallback(async () => {
    setAdviceLoading(true);
    try {
      const res = await apiFetch('/s/api/me/data/advice', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? '生成失败');
      setAdvice(String(json.data.advice ?? ''));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI 建议生成失败');
    } finally {
      setAdviceLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!data || data.totals.posts === 0) {
    return (
      <div className="glass-surface flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
        <BarChart3 className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">还没有可分析的作品数据</p>
        <p className="mt-1 text-xs text-muted-foreground/60">在创作台发布并登记链接后，这里会聚合播放/点赞/评论</p>
      </div>
    );
  }

  const tabs: Array<{ key: string; label: string }> = [
    { key: 'all', label: '总览' },
    ...data.platforms.map((p) => ({ key: p.platform, label: PLATFORM_LABEL[p.platform] ?? p.platform })),
  ];
  const tabWorks = tab === 'all' ? data.works : data.works.filter((w) => w.platform === tab);
  const tabTotals = tab === 'all'
    ? data.totals
    : data.platforms.find((p) => p.platform === tab) ?? { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 };

  return (
    <div className="space-y-3">
      {/* 头部 + 手动刷新 */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{data.totals.posts} 个作品已纳入追踪</span>
        <button
          type="button"
          aria-label="刷新数据"
          onClick={() => { setRefreshing(true); void load(); }}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-primary"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
        </button>
      </div>

      {/* 平台 Tab */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex h-8 shrink-0 items-center rounded-full border px-3.5 text-xs font-medium transition-colors',
              tab === t.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 总量指标 */}
      <div className="grid grid-cols-4 gap-2">
        <MetricTile Icon={Eye} label="播放" value={compact(tabTotals.views)} tint="text-sky-500" />
        <MetricTile Icon={Heart} label="点赞" value={compact(tabTotals.likes)} tint="text-error" />
        <MetricTile Icon={MessageCircle} label="评论" value={compact(tabTotals.comments)} tint="text-amber-500" />
        <MetricTile Icon={Share2} label="分享" value={compact(tabTotals.shares)} tint="text-violet-500" />
      </div>

      {tab === 'all' ? (
        <>
          {/* 趋势图 */}
          <div className="glass-surface rounded-2xl p-4 text-primary">
            <TrendChart series={data.series} />
          </div>

          {/* 受众 */}
          <div className="glass-surface rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-[13px] font-medium">受众画像</h3>
              <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                {data.audience.totalComments} 条评论
              </span>
            </div>
            {data.audience.totalComments === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">暂无评论数据（采集任务每 6 小时同步一次）</p>
            ) : (
              <>
                {data.audience.topCommenters.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {data.audience.topCommenters.slice(0, 6).map((c) => (
                      <span
                        key={c.author}
                        title={c.ipLocation ?? undefined}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] text-secondary-foreground"
                      >
                        <span className="truncate">{c.author}</span>
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">×{c.cnt}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {data.audience.ipLocations.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {data.audience.ipLocations.slice(0, 5).map((ip) => {
                      const maxCnt = Math.max(...data.audience.ipLocations.map((x) => x.cnt), 1);
                      return (
                        <div key={ip.loc} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 truncate text-[11px] text-muted-foreground">{ip.loc}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary/60" style={{ width: `${(ip.cnt / maxCnt) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{ip.cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* AI 建议（DSH 宿主模型） */}
          <div className="glass-surface rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <h3 className="text-[13px] font-medium">AI 运营建议</h3>
              <button
                type="button"
                onClick={() => void makeAdvice()}
                disabled={adviceLoading}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                {adviceLoading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                {adviceLoading ? '分析中…' : advice ? '重新生成' : '生成建议'}
              </button>
            </div>
            {advice ? (
              <div className="mt-2.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/90">{advice}</div>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                结合播放趋势、受众评论与作品表现，由 DSH 模型给出流量诊断与选题建议。
              </p>
            )}
          </div>
        </>
      ) : null}

      {/* 作品列表（当前 Tab） */}
      <div className="space-y-2">
        {tabWorks.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">该平台暂无已登记作品</p>
        ) : tabWorks.map((w) => (
          <button
            key={w.postId}
            type="button"
            onClick={() => window.open(w.postUrl, '_blank')}
            className="glass-surface block w-full rounded-2xl p-3 text-left transition-colors hover:bg-accent"
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-secondary-foreground">
                {PLATFORM_LABEL[w.platform] ?? w.platform}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{w.title}</span>
            </div>
            <div className="mt-2 flex items-center gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" aria-hidden="true" />{compact(w.views)}</span>
              <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" aria-hidden="true" />{compact(w.likes)}</span>
              <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" aria-hidden="true" />{compact(w.comments)}</span>
              <span className="ml-auto text-[10px]">
                {w.publishedAt ? w.publishedAt.slice(0, 10) : ''}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
