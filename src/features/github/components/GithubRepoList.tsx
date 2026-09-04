'use client';

import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GithubRepoSubscription } from '@/types';
import GithubStatusBadge from './GithubStatusBadge';
import GithubTypeBadge from './GithubTypeBadge';

interface GithubRepoListProps {
  repos: GithubRepoSubscription[];
  refreshingId: string | null;
  onEdit: (repo: GithubRepoSubscription) => void;
  onDelete: (repo: GithubRepoSubscription) => void;
  onRefresh: (repo: GithubRepoSubscription) => void;
}

function formatSyncTime(value: string | null): string {
  if (!value) {
    return '尚未同步';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function GithubRepoList({
  repos,
  refreshingId,
  onEdit,
  onDelete,
  onRefresh,
}: GithubRepoListProps) {
  if (repos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
        还没有订阅的 GitHub 仓库，点击下方「添加仓库」开始。
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      {repos.map((repo) => {
        const isRefreshing = refreshingId === repo.id;
        return (
          <article
            key={repo.id}
            className="w-full rounded-xl border border-border/80 bg-card/70 px-3 py-2.5 shadow-sm"
          >
            <div className="flex items-stretch justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex min-w-0 items-center gap-2">
                  {repo.avatarUrl ? (
                    <img
                      src={repo.avatarUrl}
                      alt=""
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 rounded-full"
                    />
                  ) : null}
                  <a
                    href={repo.htmlUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate text-sm font-semibold text-foreground hover:underline"
                  >
                    {repo.fullName}
                  </a>
                  <GithubTypeBadge type={repo.contentTypes[0] ?? 'release'} />
                </div>

                {repo.description ? (
                  <p className="truncate text-[11px] text-muted-foreground">{repo.description}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <GithubStatusBadge status={repo.status} />
                  <span>上次同步 {formatSyncTime(repo.lastSyncedAt)}</span>
                </div>

                {repo.lastError ? (
                  <div className="inline-flex max-w-full items-center rounded-md border border-destructive/20 bg-destructive/8 px-2 py-1 text-[11px] text-destructive">
                    {repo.lastError}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isRefreshing}
                    onClick={() => onRefresh(repo)}
                  >
                    <RefreshCw className={isRefreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                    {isRefreshing ? '同步中' : '同步'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onEdit(repo)}>
                    <Pencil className="h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onDelete(repo)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
                {repo.includePrerelease ? (
                  <span className="text-[11px] text-muted-foreground">包含预发布</span>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
