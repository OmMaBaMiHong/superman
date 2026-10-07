'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Bookmark,
  ChevronRight,
  Heart,
  PenLine,
  Plus,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '../lib/auth';
import { navigateTo } from '../lib/router';

type SubTab = 'works' | 'favorites' | 'data';

interface Stats {
  favorites: number;
  works: number;
  published: number;
}

/** 我的作品 / 收藏 / 数据 — 个人主页。仿抖音/小红书布局，但内容是我们的。 */
export default function H5MePage({ username }: { username?: string }) {
  const [subTab, setSubTab] = useState<SubTab>('works');
  const [stats, setStats] = useState<Stats>({ favorites: 0, works: 0, published: 0 });

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch('/s/api/me/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // 静默失败
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const subTabs: Array<{ key: SubTab; label: string; Icon: typeof Bookmark }> = [
    { key: 'works', label: '我的作品', Icon: PenLine },
    { key: 'favorites', label: '收藏', Icon: Heart },
    { key: 'data', label: '数据', Icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* 顶部个人卡片 */}
      <section className="relative overflow-hidden px-5 pb-6 pt-12">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-warning/5" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-lg font-bold text-primary">
              {username?.slice(0, 1)?.toUpperCase() || 'S'}
            </div>
            <div>
              <h1 className="text-lg font-semibold">{username || 'Superman'}</h1>
              <p className="text-xs text-muted-foreground">内容创作者工作台</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="设置"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/60"
            onClick={() => navigateTo('/settings')}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* 数字统计 */}
        <div className="relative mt-6 grid grid-cols-3 gap-3">
          <StatCard label="收藏" value={stats.favorites} />
          <StatCard label="作品" value={stats.works} />
          <StatCard label="已发布" value={stats.published} />
        </div>
      </section>

      {/* 快捷操作 */}
      <section className="px-5 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <QuickAction
            Icon={Plus}
            label="粘贴收藏"
            hint="从外部复制内容"
            onClick={() => {
              const evt = new CustomEvent('superman:open-paste');
              window.dispatchEvent(evt);
            }}
          />
          <QuickAction
            Icon={PenLine}
            label="去创作"
            hint="打开创作台"
            onClick={() => navigateTo('/studio')}
          />
        </div>
      </section>

      {/* 子标签切换 */}
      <section className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 pb-2 pt-3 backdrop-blur-md">
        <div className="flex gap-1">
          {subTabs.map((t) => {
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubTab(t.key)}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-colors',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <t.Icon className="h-3.5 w-3.5" />
                {t.label}
                {active && <span className="absolute -bottom-2 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* 子标签内容 */}
      <section className="flex-1 px-5 pt-4">
        {subTab === 'works' && <WorksList />}
        {subTab === 'favorites' && <FavoritesList />}
        {subTab === 'data' && <DataPanel />}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-card/60 py-3 backdrop-blur-sm">
      <span className="text-xl font-bold tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function QuickAction({
  Icon,
  label,
  hint,
  onClick,
}: {
  Icon: typeof Plus;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 text-left transition-colors active:bg-accent"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{hint}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function WorksList() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 py-12 text-center">
      <PenLine className="mb-3 h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">还没有作品</p>
      <p className="mt-1 text-xs text-muted-foreground/60">去创作台写点什么吧</p>
      <button
        type="button"
        onClick={() => navigateTo('/studio')}
        className="mt-4 rounded-full bg-primary/10 px-4 py-2 text-xs font-medium text-primary"
      >
        去创作台
      </button>
    </div>
  );
}

function FavoritesList() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 py-12 text-center">
      <Heart className="mb-3 h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">还没有收藏</p>
      <p className="mt-1 text-xs text-muted-foreground/60">点 + 按钮粘贴收藏内容</p>
      <button
        type="button"
        onClick={() => {
          const evt = new CustomEvent('superman:open-paste');
          window.dispatchEvent(evt);
        }}
        className="mt-4 rounded-full bg-primary/10 px-4 py-2 text-xs font-medium text-primary"
      >
        去粘贴收藏
      </button>
    </div>
  );
}

function DataPanel() {
  return (
    <div className="space-y-3">
      <DataCard title="今日收藏" value="12" trend="+3 vs 昨天" />
      <DataCard title="今日创作" value="3" trend="+1 vs 昨天" />
      <DataCard title="今日发布" value="2" trend="持平" />
      <DataCard title="待批积压" value="5" trend="需处理" highlight />
    </div>
  );
}

function DataCard({
  title,
  value,
  trend,
  highlight,
}: {
  title: string;
  value: string;
  trend: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-card/60 p-4">
      <div>
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className={cn('mt-1 text-2xl font-bold', highlight && 'text-warning')}>{value}</div>
      </div>
      <div
        className={cn(
          'rounded-full px-2.5 py-1 text-[10px]',
          highlight ? 'bg-warning/10 text-warning' : 'bg-accent text-muted-foreground',
        )}
      >
        {trend}
      </div>
    </div>
  );
}
