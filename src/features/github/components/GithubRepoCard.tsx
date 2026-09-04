'use client';

import { Code2, RefreshCw, Star } from 'lucide-react';
import GlassCard from '@/components/glass/GlassCard';
import type { GithubRepoSubscription } from '@/types';
import { cn } from '@/lib/utils';
import GithubStatusBadge from './GithubStatusBadge';
import GithubTypeBadge from './GithubTypeBadge';

interface GithubRepoCardProps {
  repo: GithubRepoSubscription;
  onSelect?: (repo: GithubRepoSubscription) => void;
  className?: string;
}

/** 大数字缩写为 1.2k / 3.4m，保持卡片宽度稳定。 */
export function formatStars(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '—';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

/** 相对时间；超过 30 天回落为绝对日期。 */
export function formatRelativeTime(value: string | null): string {
  if (!value) {
    return '尚未同步';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return '刚刚';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays <= 30) {
    return `${diffDays} 天前`;
  }

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * 仓库卡片（GitHub 模块网格单元）。
 *
 * 容器用 `GlassCard`，卡内一律不再叠加 backdrop-filter（每容器最多 1 层）。
 * 整卡可点击，因此外层是原生 `<button>`：自带键盘可达与 Enter/Space 语义。
 * 数字统一 `font-mono tabular-nums`，与 `StatCard` 对齐。
 */
export default function GithubRepoCard({ repo, onSelect, className }: GithubRepoCardProps) {
  const interactive = typeof onSelect === 'function';

  const body = (
    <GlassCard
      className={cn('flex h-full flex-col gap-3 text-left', className)}
      interactive={interactive}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {repo.avatarUrl ? (
          // 头像来自 GitHub CDN，非本域资源，走原生 img 避免 next/image 域名白名单耦合
          // （与既有 GithubRepoList 保持一致）。
          <img
            alt=""
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded-lg border border-border/60"
            src={repo.avatarUrl}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Code2 className="h-4 w-4" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{repo.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{repo.owner}</p>
        </div>

        <GithubStatusBadge className="shrink-0" status={repo.status} />
      </div>

      <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">
        {repo.description ?? '该仓库暂无描述'}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Star aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums text-foreground">
            {formatStars(repo.stargazers)}
          </span>
          <span className="sr-only">star</span>
        </span>

        {repo.language ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
            {repo.language}
          </span>
        ) : null}

        <span className="inline-flex items-center gap-1">
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums">{formatRelativeTime(repo.lastSyncedAt)}</span>
        </span>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {repo.contentTypes.map((type) => (
          <GithubTypeBadge key={type} type={type} />
        ))}
        {repo.unreadCount > 0 ? (
          <span className="ml-auto inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] tabular-nums text-primary">
            {repo.unreadCount} 未读
          </span>
        ) : null}
      </div>
    </GlassCard>
  );

  if (!interactive) {
    return body;
  }

  return (
    <button
      aria-label={`查看仓库 ${repo.fullName} 的详情`}
      className="block h-full w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={() => onSelect?.(repo)}
      type="button"
    >
      {body}
    </button>
  );
}
