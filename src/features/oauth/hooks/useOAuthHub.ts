'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteOAuthConnection,
  deleteOAuthProviderConfig,
  listOAuthConnections,
  listOAuthProviders,
  putOAuthProviderConfig,
  refreshOAuthConnection,
  startOAuthAuthorization,
  type SaveOAuthProviderConfigInput,
} from '@/lib/api/apiClient';
import type { OAuthConnectionView, OAuthProviderConfigStatus, OAuthProviderId } from '@/types';

export interface UseOAuthHubResult {
  providers: OAuthProviderConfigStatus[];
  connections: OAuthConnectionView[];
  /** 按平台索引的连接，卡片直接取用，避免每张卡片各自 find。 */
  connectionByProvider: Map<OAuthProviderId, OAuthConnectionView>;
  loading: boolean;
  reload: () => Promise<void>;
  saveConfig: (
    provider: OAuthProviderId,
    input: SaveOAuthProviderConfigInput,
  ) => Promise<OAuthProviderConfigStatus>;
  clearConfig: (provider: OAuthProviderId) => Promise<OAuthProviderConfigStatus>;
  startAuthorize: (provider: OAuthProviderId, returnTo?: string) => Promise<string>;
  revokeConnection: (id: string) => Promise<{ id: string }>;
  refreshConnection: (id: string) => Promise<OAuthConnectionView>;
}

/**
 * 三方授权中心的数据层：加载平台配置状态 + 已授权连接，并暴露全部变更操作。
 *
 * 与 `useGithubRepos` 同构——hook 只负责请求与本地 state 回写，
 * toast 与内联错误一律由组件编排（`notifyOnError: false`）。
 */
export function useOAuthHub(): UseOAuthHubResult {
  const [providers, setProviders] = useState<OAuthProviderConfigStatus[]>([]);
  const [connections, setConnections] = useState<OAuthConnectionView[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProviders, nextConnections] = await Promise.all([
        listOAuthProviders({ notifyOnError: false }),
        listOAuthConnections({ notifyOnError: false }),
      ]);
      setProviders(nextProviders);
      setConnections(nextConnections);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsertProvider = useCallback((updated: OAuthProviderConfigStatus) => {
    setProviders((current) => {
      const existed = current.some((item) => item.provider === updated.provider);
      return existed
        ? current.map((item) => (item.provider === updated.provider ? updated : item))
        : [...current, updated];
    });
  }, []);

  const upsertConnection = useCallback((updated: OAuthConnectionView) => {
    setConnections((current) => {
      const existed = current.some((item) => item.id === updated.id);
      return existed
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [...current, updated];
    });
  }, []);

  const saveConfig = useCallback(
    async (provider: OAuthProviderId, input: SaveOAuthProviderConfigInput) => {
      const status = await putOAuthProviderConfig(provider, input, { notifyOnError: false });
      upsertProvider(status);
      return status;
    },
    [upsertProvider],
  );

  const clearConfig = useCallback(
    async (provider: OAuthProviderId) => {
      const status = await deleteOAuthProviderConfig(provider, { notifyOnError: false });
      upsertProvider(status);
      return status;
    },
    [upsertProvider],
  );

  const startAuthorize = useCallback(async (provider: OAuthProviderId, returnTo?: string) => {
    const result = await startOAuthAuthorization(provider, returnTo, { notifyOnError: false });
    return result.authorizeUrl;
  }, []);

  const revokeConnection = useCallback(async (id: string) => {
    const result = await deleteOAuthConnection(id, { notifyOnError: false });
    setConnections((current) => current.filter((item) => item.id !== id));
    return result;
  }, []);

  const refreshConnection = useCallback(
    async (id: string) => {
      const view = await refreshOAuthConnection(id, { notifyOnError: false });
      upsertConnection(view);
      return view;
    },
    [upsertConnection],
  );

  const connectionByProvider = useMemo(() => {
    const map = new Map<OAuthProviderId, OAuthConnectionView>();
    for (const connection of connections) {
      // MVP 每平台至多一个连接（R13 多账号是 P1），后来者覆盖前者即可。
      map.set(connection.provider, connection);
    }
    return map;
  }, [connections]);

  return {
    providers,
    connections,
    connectionByProvider,
    loading,
    reload,
    saveConfig,
    clearConfig,
    startAuthorize,
    revokeConnection,
    refreshConnection,
  };
}
