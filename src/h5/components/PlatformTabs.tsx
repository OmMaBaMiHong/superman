'use client';

/**
 * 平台与账号：区块最顶部的平台 Tab——中转站与各内容平台平级，一个平台一个 Tab。
 * 每个 Tab 聚合该平台的一切：授权账号（验证/删除/添加）、采集 Cookie 登录态、
 * 发布与流量数据概览。「＋」直接唤起添加账号面板（平台任选）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import {
  createPlatformAccount,
  deletePlatformAccount,
  listPlatformAccounts,
  verifyPlatformAccount,
  type AccountPlatform,
  type PlatformAccount,
} from '@/lib/api/apiClient';
import { listRssHubCookies } from '@/lib/api/apiClient';
import type { RssHubCookieView } from '@/types';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { ACCOUNT_PLATFORM_META } from '../lib/accountPlatforms';
import { AccountCard } from './PlatformAccountsPanel';
import AddAccountSheet from './AddAccountSheet';
import { ProviderCard, PROVIDERS } from './PlatformCollectCookies';
import RelayPanel from './RelayPanel';
import { apiFetch } from '../lib/auth';

type TabKey = 'relay' | 'chaos' | AccountPlatform;

const PLATFORM_ORDER: AccountPlatform[] = ['wechat', 'douyin', 'xhs', 'channels', 'kuaishou', 'bilibili', 'weibo'];

/** 非内容平台的 tab 图标（chaos 不是 AccountPlatform，不能从 META 取，否则 undefined.icon 崩整页）。 */
const TAB_ICON: Partial<Record<TabKey, string>> = { relay: '🌐', chaos: '🛰️' };

/** 发布追踪表的平台键与授权平台键差异：视频号授权叫 channels，发布数据叫 wechat */
const OVERVIEW_PLATFORM_KEY: Partial<Record<AccountPlatform, string>> = { channels: 'wechat' };

/** 采集 Cookie 的 provider 键差异：小红书授权叫 xhs，Cookie 叫 xiaohongshu */
const COOKIE_PROVIDER_KEY: Partial<Record<AccountPlatform, string>> = { xhs: 'xiaohongshu' };

function compact(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function PlatformTabs() {
  const [tab, setTab] = useState<TabKey>('relay');
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [cookieMap, setCookieMap] = useState<Map<string, RssHubCookieView>>(new Map());
  const [platformData, setPlatformData] = useState<Map<string, { posts: number; views: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addPlatform, setAddPlatform] = useState<AccountPlatform | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [accs, cookieList, overviewRes] = await Promise.all([
        listPlatformAccounts(undefined, { notifyOnError: false }).catch(() => null),
        listRssHubCookies({ notifyOnError: false }).catch(() => null),
        apiFetch('/s/api/me/data/overview').then((r) => r.json()).catch(() => null),
      ]);
      if (accs) setAccounts(accs.items);
      if (Array.isArray(cookieList)) setCookieMap(new Map(cookieList.map((v: RssHubCookieView) => [v.provider, v])));
      if (overviewRes?.ok) {
        setPlatformData(new Map(
          (overviewRes.data.platforms ?? []).map((p: { platform: string; posts: number; views: number }) => [
            p.platform, { posts: p.posts, views: p.views },
          ]),
        ));
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback((input: {
    platform: AccountPlatform;
    accountName: string;
    credKind: 'app_secret' | 'cookie';
    credential: Record<string, unknown>;
  }) => {
    setSubmitting(true);
    void createPlatformAccount(input)
      .then(() => {
        toast.success('账号已保存（凭据加密落库）');
        setAddOpen(false);
        void load();
      })
      .catch(() => {})
      .finally(() => setSubmitting(false));
  }, [load]);

  const handleVerify = useCallback((account: PlatformAccount) => {
    setVerifyingId(account.id);
    void verifyPlatformAccount(account.id)
      .then((result) => {
        if (result.verified) {
          toast.success(`「${account.accountName || ACCOUNT_PLATFORM_META[account.platform]?.name || account.platform}」验证通过`);
        } else {
          toast.error(result.reason ?? '验证失败');
        }
        void load();
      })
      .catch(() => {})
      .finally(() => setVerifyingId(null));
  }, [load]);

  const handleDelete = useCallback((account: PlatformAccount) => {
    void deletePlatformAccount(account.id)
      .then(() => {
        toast.success('已删除');
        void load();
      })
      .catch(() => {});
  }, [load]);

  const openAdd = (platform?: AccountPlatform) => {
    setAddPlatform(platform);
    setAddOpen(true);
  };

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'relay', label: '中转站' },
    { key: 'chaos', label: '数据中台' },
    ...PLATFORM_ORDER.map((p) => ({ key: p as TabKey, label: ACCOUNT_PLATFORM_META[p].name })),
  ];

  // ── Chaos 数据中台（与中转站/内容平台平级的一个 Tab）──
  const [chaosLinked, setChaosLinked] = useState<boolean | null>(null);
  const loadChaos = useCallback(async () => {
    try {
      const json = await apiFetch('/s/api/chaos/auth/me').then((r) => r.json());
      setChaosLinked(Boolean(json.ok && json.data?.linked));
    } catch {
      setChaosLinked(false);
    }
  }, []);
  useEffect(() => {
    void loadChaos();
    if (!window.location.hash.includes('chaos=linked')) return undefined;
    void loadChaos();
    return undefined;
  }, [loadChaos]);
  const connectChaos = useCallback(() => {
    void (async () => {
      try {
        const json = await apiFetch('/s/api/chaos/auth/start').then((r) => r.json());
        if (json.ok && json.data?.authorizationUrl) window.location.href = json.data.authorizationUrl;
      } catch {
        // 静默：按钮保持可点
      }
    })();
  }, []);
  const isPlatform = (t: TabKey): t is AccountPlatform => t !== 'relay' && t !== 'chaos';
  const meta = isPlatform(tab) ? ACCOUNT_PLATFORM_META[tab] : null;
  const tabAccounts = isPlatform(tab) ? accounts.filter((a) => a.platform === tab) : [];
  const cookieProvider = isPlatform(tab)
    ? PROVIDERS.find((x) => x.id === (COOKIE_PROVIDER_KEY[tab] ?? tab))
    : undefined;
  const stats = isPlatform(tab) ? platformData.get(OVERVIEW_PLATFORM_KEY[tab] ?? tab) : undefined;

  return (
    <section aria-label="平台与账号" className="glass-surface p-5">
      {/* Tab 条（区块最顶部）：中转站与内容平台平级，+ 新增 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors',
              tab === key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_ICON[key] ?? ACCOUNT_PLATFORM_META[key as AccountPlatform]?.icon ?? '🔗'}
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-label="添加平台账号"
          onClick={() => openAdd()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4">
        {tab === 'relay' ? (
          <>
            <p className="px-1 text-[11px] text-muted-foreground">授权登录后，洗稿 / 媒体生成等会员功能即刻可用</p>
            <div className="mt-2.5">
              <RelayPanel />
            </div>
          </>
        ) : tab === 'chaos' ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">数据中台账号</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {chaosLinked === null
                  ? '检查绑定状态…'
                  : chaosLinked
                    ? '已绑定，推荐与素材行为带中台用户身份'
                    : '绑定后推荐与素材行为带中台用户身份'}
              </p>
            </div>
            <button
              type="button"
              onClick={connectChaos}
              className="inline-flex h-9 shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-4 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              {chaosLinked ? '重新授权' : '去授权'}
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* 数据概览 */}
            <div className="flex items-center gap-2 rounded-xl bg-secondary/40 px-3.5 py-2.5">
              <span className="text-[11px] text-muted-foreground">发布数据</span>
              {stats ? (
                <span className="ml-auto font-mono text-[11px] tabular-nums text-foreground">
                  {stats.posts} 个作品 · 播放 {compact(stats.views)}
                </span>
              ) : (
                <span className="ml-auto text-[11px] text-muted-foreground">暂无（创作台发布并登记后计入）</span>
              )}
            </div>

            {/* 账号授权 */}
            <div>
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[12px] font-medium text-foreground">授权账号</h3>
                <button
                  type="button"
                  onClick={() => openAdd(tab as AccountPlatform)}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 text-[11px] font-medium text-primary"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  添加账号
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {tabAccounts.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3.5 py-4 text-center text-[11px] text-muted-foreground">
                    {meta?.supported ? `还没有${meta.name}账号，添加后稿件可发布到${meta.name}` : `${meta?.name}发布能力待接入，可先添加账号备用`}
                  </p>
                ) : (
                  tabAccounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      verifying={verifyingId === account.id}
                      onVerify={() => handleVerify(account)}
                      onDelete={() => handleDelete(account)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* 采集登录态 */}
            <div>
              <h3 className="px-1 text-[12px] font-medium text-foreground">采集登录态</h3>
              {cookieProvider ? (
                <div className="mt-2">
                  <ProviderCard
                    provider={cookieProvider}
                    view={cookieMap.get(cookieProvider.id) ?? null}
                    onSaved={() => void load()}
                  />
                </div>
              ) : (
                <p className="mt-2 rounded-xl bg-secondary/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
                  该平台无需配置采集 Cookie
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <AddAccountSheet
        open={addOpen}
        submitting={submitting}
        initialPlatform={addPlatform}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
        onDouyinAdded={() => {
          toast.success('扫码授权成功，账号已加密落库');
          setAddOpen(false);
          void load();
        }}
      />
    </section>
  );
}
