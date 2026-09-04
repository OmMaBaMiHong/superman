'use client';

import { useCallback, useMemo, useState } from 'react';
import { Github } from 'lucide-react';
import EmptyState from '@/components/glass/EmptyState';
import ErrorState from '@/components/glass/ErrorState';
import { GlassSkeletonList } from '@/components/glass/GlassSkeleton';
import { useGithubRepos } from '@/features/github/hooks/useGithubRepos';
import type { GithubRepoSubscription } from '@/types';
import { cn } from '@/lib/utils';
import GithubRepoCard from './GithubRepoCard';
import GithubRepoDetailDrawer from './GithubRepoDetailDrawer';

interface GithubPageProps {
  className?: string;
}

/**
 * GitHub 模块页面容器。
 *
 * 数据来源：`useGithubRepos`（真实接口 `/api/github/repos` + `/api/settings/github/token`）。
 * 抽屉内的活动时间轴目前没有对应后端接口（ADR-03 取消了 `/api/github/articles`，
 * 而 `/api/reader/snapshot` 不支持按 feedId 过滤），因此以「未接入态」呈现，
 * 不编造假数据。接口到位后只需给 `GithubRepoDetailDrawer` 传 `timelineItems`。
 *
 * 外层刻意不套 `.glass-surface`：本页会挂进已是玻璃面板的父容器，
 * 每容器最多 1 层 backdrop-filter。
 */
export default function GithubPage({ className }: GithubPageProps) {
  const { repos, loading, error, reload } = useGithubRepos();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedId) ?? null,
    [repos, selectedId],
  );

  const handleSelect = useCallback((repo: GithubRepoSubscription) => {
    setSelectedId(repo.id);
    setDrawerOpen(true);
  }, []);

  const handleRetry = useCallback(() => {
    void reload();
  }, [reload]);

  return (
    <div className={cn('flex flex-col gap-5 p-4 sm:p-6', className)}>
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Github aria-hidden="true" className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight text-foreground">GitHub</h1>
          {!loading && !error && repos.length > 0 ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {repos.length}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          已订阅仓库的 Release、PR、Issue 与 Commit 动态。
        </p>
      </header>

      {loading ? <GlassSkeletonList count={6} /> : null}

      {!loading && error ? (
        <ErrorState description={error} onRetry={handleRetry} title="GitHub 订阅加载失败" />
      ) : null}

      {!loading && !error && repos.length === 0 ? (
        <EmptyState
          description="在「设置 › GitHub」中添加 owner/repo 即可开始追踪仓库动态。"
          icon={Github}
          title="还没有订阅仓库"
        />
      ) : null}

      {!loading && !error && repos.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {repos.map((repo) => (
            <GithubRepoCard key={repo.id} onSelect={handleSelect} repo={repo} />
          ))}
        </div>
      ) : null}

      <GithubRepoDetailDrawer
        onOpenChange={setDrawerOpen}
        open={drawerOpen}
        repo={selectedRepo}
        timelineEmptyDescription="仓库动态接口尚未接入，条目数据到位后此处会展示 Release / PR / Issue / Commit 时间轴。"
        timelineItems={[]}
      />
    </div>
  );
}
