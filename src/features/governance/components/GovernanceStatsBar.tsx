'use client';

import type { GovernanceStats } from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';

interface StatCellProps {
  label: string;
  latinLabel: string;
  value: number | null;
  dotClassName: string;
  pulse?: boolean;
}

function StatCell({ label, latinLabel, value, dotClassName, pulse = false }: StatCellProps) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          dotClassName,
          pulse && 'gov-pulse-dot',
        )}
      />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
            {value === null ? '—' : value}
          </span>
          <span className="truncate text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="gov-label mt-0.5">{latinLabel}</div>
      </div>
    </div>
  );
}

interface GovernanceStatsBarProps {
  stats: GovernanceStats | null;
}

/** 顶部统计条：今日待批 / 今日归档 / 采集成功 / 采集失败 / 队列深度，带呼吸灯。 */
export default function GovernanceStatsBar({ stats }: GovernanceStatsBarProps) {
  return (
    <section
      aria-label="治理统计"
      className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border bg-card sm:grid-cols-3 lg:grid-cols-5"
    >
      <StatCell
        label="今日待批"
        latinLabel="Pending"
        value={stats?.todayPending ?? null}
        dotClassName="bg-warning"
        pulse
      />
      <StatCell
        label="今日归档"
        latinLabel="Archived"
        value={stats?.todayArchived ?? null}
        dotClassName="bg-success"
      />
      <StatCell
        label="采集成功"
        latinLabel="Fetch OK"
        value={stats?.todayFetchSucceeded ?? null}
        dotClassName="bg-primary"
        pulse
      />
      <StatCell
        label="采集失败"
        latinLabel="Fetch ERR"
        value={stats?.todayFetchFailed ?? null}
        dotClassName="bg-error"
        pulse={(stats?.todayFetchFailed ?? 0) > 0}
      />
      <StatCell
        label="队列深度"
        latinLabel="Queue"
        value={stats?.queueSize ?? null}
        dotClassName="bg-primary"
        pulse
      />
    </section>
  );
}
