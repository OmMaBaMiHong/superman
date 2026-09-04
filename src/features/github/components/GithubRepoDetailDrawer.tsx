'use client';

import { ExternalLink, Star } from 'lucide-react';
import DetailDrawer from '@/components/glass/DetailDrawer';
import { Button } from '@/components/ui/button';
import type { GithubRepoSubscription } from '@/types';
import GithubActivityTimeline, { type GithubTimelineItem } from './GithubActivityTimeline';
import GithubStatusBadge from './GithubStatusBadge';
import GithubTypeBadge from './GithubTypeBadge';
import { formatRelativeTime, formatStars } from './GithubRepoCard';

interface GithubRepoDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关闭动画期间仍可能为上一个仓库；为 null 时只渲染骨架标题。 */
  repo: GithubRepoSubscription | null;
  timelineItems?: GithubTimelineItem[];
  timelineLoading?: boolean;
  /** 时间轴数据源未接入时的说明。 */
  timelineEmptyDescription?: string;
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

/**
 * 仓库详情抽屉。
 *
 * 直接复用 `components/glass/DetailDrawer`（Radix Sheet：focus trap / ESC / 遮罩自带），
 * 不另造第二套抽屉实现。抽屉内不再叠加 backdrop-filter，
 * 玻璃层由 DetailDrawer 自身的 `.glass-surface-strong` 提供。
 */
export default function GithubRepoDetailDrawer({
  open,
  onOpenChange,
  repo,
  timelineItems = [],
  timelineLoading = false,
  timelineEmptyDescription,
}: GithubRepoDetailDrawerProps) {
  return (
    <DetailDrawer
      description={repo?.description ?? undefined}
      footer={
        repo ? (
          <Button asChild className="w-full" size="sm" variant="outline">
            <a href={repo.htmlUrl} rel="noreferrer noopener" target="_blank">
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              在 GitHub 打开
            </a>
          </Button>
        ) : null
      }
      onOpenChange={onOpenChange}
      open={open}
      title={repo?.fullName ?? '仓库详情'}
    >
      {repo ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <GithubStatusBadge status={repo.status} />
            {repo.contentTypes.map((type) => (
              <GithubTypeBadge key={type} type={type} />
            ))}
            {repo.includePrerelease ? (
              <span className="text-[11px] text-muted-foreground">含预发布</span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric label="Star" value={formatStars(repo.stargazers)} />
            <Metric label="语言" value={repo.language ?? '—'} />
            <Metric label="未读" value={String(repo.unreadCount)} />
            <Metric label="上次同步" value={formatRelativeTime(repo.lastSyncedAt)} />
          </div>

          {repo.lastError ? (
            <p
              className="rounded-xl border border-error/25 bg-error/10 px-3 py-2 text-xs text-error"
              role="alert"
            >
              {repo.lastError}
            </p>
          ) : null}

          <section aria-label="仓库动态时间轴">
            <div className="mb-3 flex items-center gap-2">
              <Star aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">动态</h3>
            </div>
            <GithubActivityTimeline
              emptyDescription={timelineEmptyDescription}
              items={timelineItems}
              loading={timelineLoading}
            />
          </section>
        </div>
      ) : null}
    </DetailDrawer>
  );
}
