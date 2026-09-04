'use client';

import { CheckCheck, Hourglass, Inbox, MailOpen } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import ParticleStatCard from './ParticleStatCard';
import ReadingFlowView from './ReadingFlowView';

/** 「长期未读」的判定阈值：发布超过 7 天且仍未读。 */
const STALE_THRESHOLD_DAYS = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** 本地时区当天 00:00 的时间戳；同一天内恒定，可安全用作外部快照。 */
function readLocalDayStart(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 服务端无法得知客户端时区，返回 0 表示「日期相关指标暂不可用」。 */
function readServerDayStart(): number {
  return 0;
}

function subscribeNever(): () => void {
  return () => {};
}

export interface OverviewPageProps {
  className?: string;
}

/**
 * 总览页：4 张粒子统计卡片 + 中央 3D 阅读流转视图。
 *
 * 指标全部由 `useAppStore` 现有的 `feeds` / `articles` 推导，不新增 API、不改 store。
 * 外层刻意不套 `.glass-surface`（父容器已是玻璃面板，避免叠加 backdrop-filter）。
 */
export default function OverviewPage({ className }: OverviewPageProps) {
  const feeds = useAppStore((state) => state.feeds);
  const articles = useAppStore((state) => state.articles);

  // 「今日」「7 天前」依赖客户端本地时区，服务端无从得知。
  // 用 useSyncExternalStore 拿当天 00:00（同一天内恒定），既满足 hooks 纯度规则，
  // 也保证 SSR 首帧与 CSR 不产生文本不一致（服务端快照为 0）。
  const dayStart = useSyncExternalStore(subscribeNever, readLocalDayStart, readServerDayStart);

  const metrics = useMemo(() => {
    const hasClock = dayStart > 0;
    const staleBefore = hasClock ? dayStart - STALE_THRESHOLD_DAYS * DAY_IN_MS : 0;

    let inbox = 0;
    let read = 0;
    let stale = 0;

    for (const article of articles) {
      const publishedAt = parseTimestamp(article.publishedAt);
      if (hasClock && publishedAt !== null && publishedAt >= dayStart) inbox += 1;
      if (article.isRead) {
        read += 1;
      } else if (hasClock && publishedAt !== null && publishedAt < staleBefore) {
        stale += 1;
      }
    }

    const unreadFromFeeds = feeds.reduce(
      (sum, feed) => sum + (Number.isFinite(feed.unreadCount) ? feed.unreadCount : 0),
      0,
    );
    const unread = unreadFromFeeds > 0
      ? unreadFromFeeds
      : articles.filter((article) => !article.isRead).length;

    return { inbox, unread, read, stale, total: articles.length };
  }, [articles, dayStart, feeds]);

  return (
    <div className={cn('flex flex-col gap-6 p-5 sm:p-6', className)}>
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">总览</h2>
        <p className="text-sm text-muted-foreground">
          订阅流转与阅读消化的实时快照，帮你一眼看清待处理的内容压力。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 [perspective:1100px] sm:grid-cols-2 lg:grid-cols-4">
        <ParticleStatCard
          label="今日新增"
          value={metrics.inbox}
          hint="今天发布的条目"
          accentVar="--overview-accent-inbox"
          icon={Inbox}
        />
        <ParticleStatCard
          label="未读库存"
          value={metrics.unread}
          hint="全部订阅源待读合计"
          accentVar="--overview-accent-unread"
          icon={MailOpen}
        />
        <ParticleStatCard
          label="已阅读"
          value={metrics.read}
          hint="当前列表内已读条目"
          accentVar="--overview-accent-read"
          icon={CheckCheck}
        />
        <ParticleStatCard
          label="长期未读"
          value={metrics.stale}
          hint={`超过 ${STALE_THRESHOLD_DAYS} 天仍未读`}
          accentVar="--overview-accent-stale"
          icon={Hourglass}
        />
      </div>

      <ReadingFlowView total={metrics.total} processed={metrics.read} />
    </div>
  );
}
