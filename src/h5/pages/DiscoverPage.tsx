'use client';

import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Compass, Flame, Github, Plus, Puzzle, Rss } from 'lucide-react';
import {
  listSubscribePrefs,
  listSubscribeSources,
  type SubscribeSourceEntry,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import SubscribeTabs, {
  type NavIcon,
  type SubscribeNavState,
  type SubscribePill,
} from '../components/SubscribeTabs';

const TrendingConsole = lazy(() => import('@/features/trending/components/TrendingConsole'));
/** 「订阅 → RSS 订阅」= 阅读器三栏本体（与「收藏」同一个组件，embedded 去掉整页高度约束）。 */
const H5ReaderPage = lazy(() => import('./ReaderPage'));

/** 一级来源图标注册表：subscribe_sources.icon → lucide 组件（未知图标回退罗盘）。 */
const SOURCE_ICONS: Record<string, NavIcon> = {
  flame: Flame,
  rss: Rss,
  github: Github,
  puzzle: Puzzle,
  bell: Rss,
  zap: Flame,
  newspaper: Rss,
};

/** 数据库不可用/无配置时的兜底来源（与 0016 迁移种子一致）。 */
const DEFAULT_SOURCES: SubscribeSourceEntry[] = [
  { key: 'hot', label: '热点新闻', icon: 'flame', sort: 10 },
  { key: 'rss', label: 'RSS 订阅', icon: 'rss', sort: 20 },
  { key: 'github', label: 'GitHub', icon: 'github', sort: 30 },
  { key: 'dsh', label: 'DSH 插件', icon: 'puzzle', sort: 40 },
];

export interface DiscoverPageProps {
  /** 进入时的子 tab key（/discover?tab=github 等）；缺省第一个来源。 */
  initialTab?: string;
}

export default function DiscoverPage({ initialTab }: DiscoverPageProps = {}) {
  const [sources, setSources] = useState<SubscribeSourceEntry[]>(DEFAULT_SOURCES);
  const [subTab, setSubTab] = useState<string>(initialTab ?? DEFAULT_SOURCES[0]?.key ?? 'hot');
  // 用户订阅偏好：sourceKey → 子类 key 列表。未勾选 = 不展示（订阅制：勾了才给看）。
  const [prefs, setPrefs] = useState<Record<string, string[]>>({});
  // 通道视图（热点控制台等）上报给统一导航的数据
  const [navState, setNavState] = useState<SubscribeNavState>({});
  const handleNavUpdate = useCallback((next: SubscribeNavState) => setNavState(next), []);
  // 统一「+」面板保存勾选后：看板重挂载一次（宿主是「保存即采集」，给 1.5s 落库时间）
  const [boardEpoch, setBoardEpoch] = useState(0);

  const load = useCallback(async () => {
    try {
      const [src, prefRows] = await Promise.all([
        listSubscribeSources({ notifyOnError: false }).catch(() => DEFAULT_SOURCES),
        listSubscribePrefs({ notifyOnError: false }).catch(() => []),
      ]);
      if (src.length > 0) setSources(src);
      const grouped: Record<string, string[]> = {};
      for (const row of prefRows) {
        (grouped[row.sourceKey] ??= []).push(row.prefKey);
      }
      setPrefs(grouped);
    } catch {
      // 静默：保持已有状态
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 统一「+」面板里保存了勾选：重载偏好，并在采集落库后让看板重新拉一次
  useEffect(() => {
    const onPrefsChanged = () => {
      void load();
      window.setTimeout(() => setBoardEpoch((value) => value + 1), 1500);
    };
    window.addEventListener('superman:prefs-changed', onPrefsChanged);
    return () => window.removeEventListener('superman:prefs-changed', onPrefsChanged);
  }, [load]);

  // 切到非通道视图时清掉通道上报的导航数据（避免残留）
  useEffect(() => {
    if (subTab === 'rss') setNavState({});
  }, [subTab]);


  // 加号 = 打开统一「+」面板（收藏 / 热点新闻 / RSS 订阅 / GitHub / DSH 插件 五个 tab），
  // 直接落在当前来源；订阅页自己不再维护第二套勾选面板。
  const plusButton = (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('superman:open-add', { detail: { tab: subTab } }))}
      aria-label="订阅管理"
      title="订阅管理"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary transition-colors duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
    </button>
  );

  const trendingView = (channel: 'news' | 'github' | 'dsh') => (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
        </div>
      }
    >
      <TrendingConsole
        key={`${channel}:${boardEpoch}`}
        embedded
        initialHotTab={channel}
        // 订阅制：勾了才展示（空数组 = 未勾选任何子类 → 通道显示引导）
        platformFilter={
          subTab === 'hot'
            ? prefs.hot && prefs.hot.length > 0
              ? prefs.hot
              : undefined // 没勾过 = 全部平台（默认全选）
            : undefined
        }
        categoryFilter={subTab === 'github' || subTab === 'dsh' ? (subTab === 'github' ? prefs.github ?? [] : prefs.dsh ?? []) : undefined}
        onNavUpdate={handleNavUpdate}
      />
    </Suspense>
  );

  // 统一导航数据：通道视图（热点/GitHub/DSH）来自控制台上报；RSS 是阅读器本体，不挂 pills
  const activeNav: SubscribeNavState = navState;

  return (
    <div
      className={
        subTab === 'rss'
          ? // RSS = 阅读器三栏：占满面板剩余高度（顶上还有宿主 48px 面板标签条）
            'flex h-[calc(100dvh-3rem)] min-h-0 flex-col overflow-hidden bg-background'
          : 'flex min-h-screen flex-col bg-background'
      }
    >
      <main
        className={
          subTab === 'rss' ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col px-0 pb-3 pt-4'
        }
      >
        <SubscribeTabs
          tabs={sources.map((s) => ({ key: s.key, label: s.label, Icon: SOURCE_ICONS[s.icon] ?? Compass }))}
          active={subTab}
          onChange={setSubTab}
          pillGroups={activeNav.pillGroups}
          onPill={activeNav.onPill}
          stats={activeNav.stats}
          plus={plusButton}
          sync={(subTab === 'hot' || subTab === 'rss') && navState.canSync ? { syncing: !!navState.syncing, onSync: navState.onSync! } : null}
          onRefresh={activeNav.onRefresh}
          className="px-4 shrink-0"
        />

        {subTab === 'hot' ? (
          // 热点新闻：平台榜单（插件自采 trend_radar_items + 中台补充渠道；按订阅平台过滤）
          trendingView('news')
        ) : null}

        {subTab === 'github' ? (
          // GitHub：中台 GitHub 趋势仓库通道（按订阅分类过滤）
          trendingView('github')
        ) : null}

        {subTab === 'dsh' ? (
          // DSH 插件：中台插件市场通道
          trendingView('dsh')
        ) : null}

        {subTab === 'rss' ? (
          // RSS 订阅 = 已订阅博主的阅读流本体（三栏：博主 / 作品 / 详情）。
          // 新增订阅走顶部「+」勾选面板；已订阅的博主不再重复出现候选列表。
          <Suspense
            fallback={
              <div className="flex min-h-[40vh] items-center justify-center">
                <span className="gov-pulse-dot h-2 w-2 rounded-full bg-primary" aria-label="加载中" />
              </div>
            }
          >
            <H5ReaderPage embedded onNavUpdate={handleNavUpdate} />
          </Suspense>
        ) : null}

        {!['hot', 'rss', 'github', 'dsh'].includes(subTab) ? (
          // 配置化新增的来源：内容视图按 key 渐进接入
          <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">「{sources.find((s) => s.key === subTab)?.label ?? subTab}」内容视图即将上线</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
