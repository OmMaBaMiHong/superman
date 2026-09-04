'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteRssHubCookie,
  listRssHubCookies,
  putRssHubCookie,
  type SaveRssHubCookieInput,
} from '@/lib/api/apiClient';
import type { RssHubCookieProvider, RssHubCookieView } from '@/types';

export interface UseRssHubCookiesResult {
  cookies: RssHubCookieView[];
  loading: boolean;
  reload: () => Promise<void>;
  saveCookie: (
    provider: RssHubCookieProvider,
    input: SaveRssHubCookieInput,
  ) => Promise<RssHubCookieView>;
  clearCookie: (provider: RssHubCookieProvider) => Promise<RssHubCookieView>;
}

/**
 * RSSHub 平台 Cookie 授权的数据层：加载各平台 Cookie 状态并暴露增删操作。
 *
 * 与 `useOAuthHub` 同构——hook 只负责请求与本地 state 回写，
 * toast 与内联错误一律由组件编排（`notifyOnError: false`）。
 */
export function useRssHubCookies(): UseRssHubCookiesResult {
  const [cookies, setCookies] = useState<RssHubCookieView[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listRssHubCookies({ notifyOnError: false });
      setCookies(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsertView = useCallback((updated: RssHubCookieView) => {
    setCookies((current) => {
      const existed = current.some((item) => item.provider === updated.provider);
      return existed
        ? current.map((item) => (item.provider === updated.provider ? updated : item))
        : [...current, updated];
    });
  }, []);

  const saveCookie = useCallback(
    async (provider: RssHubCookieProvider, input: SaveRssHubCookieInput) => {
      const view = await putRssHubCookie(provider, input, { notifyOnError: false });
      upsertView(view);
      return view;
    },
    [upsertView],
  );

  const clearCookie = useCallback(
    async (provider: RssHubCookieProvider) => {
      const view = await deleteRssHubCookie(provider, { notifyOnError: false });
      upsertView(view);
      return view;
    },
    [upsertView],
  );

  return {
    cookies,
    loading,
    reload,
    saveCookie,
    clearCookie,
  };
}
