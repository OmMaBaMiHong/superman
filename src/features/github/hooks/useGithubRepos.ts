'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createGithubRepo,
  deleteGithubRepo,
  deleteGithubToken,
  getGithubTokenStatus,
  listGithubRepos,
  patchGithubRepo,
  putGithubToken,
  refreshGithubRepo,
  type CreateGithubRepoInput,
  type UpdateGithubRepoInput,
} from '@/lib/api/apiClient';
// apiClient 只 import 这两个类型、并未 re-export，故直接从类型源头取。
import type { GithubRepoSubscription, GithubTokenStatus } from '@/types';

export interface GithubRefreshResult {
  enqueued: boolean;
  feedId: string;
  reason?: 'already_enqueued';
}

export interface UseGithubReposResult {
  repos: GithubRepoSubscription[];
  tokenStatus: GithubTokenStatus | null;
  loading: boolean;
  /** 首屏/重载失败原因；成功后回落为 null。 */
  error: string | null;
  reload: () => Promise<void>;
  createRepo: (input: CreateGithubRepoInput) => Promise<GithubRepoSubscription>;
  updateRepo: (feedId: string, input: UpdateGithubRepoInput) => Promise<GithubRepoSubscription>;
  removeRepo: (feedId: string) => Promise<{ id: string }>;
  refreshRepo: (feedId: string) => Promise<GithubRefreshResult>;
  saveToken: (token: string) => Promise<GithubTokenStatus>;
  clearToken: () => Promise<GithubTokenStatus>;
}

/**
 * 管理 GitHub 订阅列表与 Token 状态的加载与变更。
 * 这里是纯数据层：组件负责编排 toast 与内联错误，hook 负责把结果写回本地 state。
 */
export function useGithubRepos(): UseGithubReposResult {
  const [repos, setRepos] = useState<GithubRepoSubscription[]>([]);
  const [tokenStatus, setTokenStatus] = useState<GithubTokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRepos, nextToken] = await Promise.all([
        listGithubRepos({ notifyOnError: false }),
        getGithubTokenStatus({ notifyOnError: false }),
      ]);
      setRepos(nextRepos);
      setTokenStatus(nextToken);
      setError(null);
    } catch (cause) {
      // 首屏由 useEffect 触发，无处 catch；这里落成 error 态供 ErrorState 消费。
      setError(cause instanceof Error ? cause.message : '加载 GitHub 订阅失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsertRepo = useCallback((updated: GithubRepoSubscription) => {
    setRepos((current) => {
      const existed = current.some((repo) => repo.id === updated.id);
      return existed
        ? current.map((repo) => (repo.id === updated.id ? updated : repo))
        : [...current, updated];
    });
  }, []);

  const createRepo = useCallback(
    async (input: CreateGithubRepoInput) => {
      const created = await createGithubRepo(input, { notifyOnError: false });
      upsertRepo(created);
      return created;
    },
    [upsertRepo],
  );

  const updateRepo = useCallback(
    async (feedId: string, input: UpdateGithubRepoInput) => {
      const updated = await patchGithubRepo(feedId, input, { notifyOnError: false });
      upsertRepo(updated);
      return updated;
    },
    [upsertRepo],
  );

  const removeRepo = useCallback(async (feedId: string) => {
    const result = await deleteGithubRepo(feedId, { notifyOnError: false });
    setRepos((current) => current.filter((repo) => repo.id !== feedId));
    return result;
  }, []);

  const refreshRepo = useCallback(async (feedId: string) => {
    return refreshGithubRepo(feedId, { notifyOnError: false });
  }, []);

  const saveToken = useCallback(async (token: string) => {
    const status = await putGithubToken(token, { notifyOnError: false });
    setTokenStatus(status);
    return status;
  }, []);

  const clearToken = useCallback(async () => {
    const status = await deleteGithubToken({ notifyOnError: false });
    setTokenStatus(status);
    return status;
  }, []);

  return {
    repos,
    tokenStatus,
    loading,
    error,
    reload,
    createRepo,
    updateRepo,
    removeRepo,
    refreshRepo,
    saveToken,
    clearToken,
  };
}
