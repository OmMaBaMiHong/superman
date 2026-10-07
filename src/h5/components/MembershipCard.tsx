'use client';

import { Crown, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getRelayStatus, relaySync, type RelayStatus, type RelaySubscriptionView } from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';

/**
 * 我的页 · 中转站会员卡（P2e-6）：授权入口 + 会员状态 + 订阅列表。
 * 未授权 = 明显的授权入口；已授权 = 套餐/到期/订阅列表摘要。
 * 完整管理（Key/模型/退出）在 设置 抽屉的同一张卡里。
 */
export default function MembershipCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getRelayStatus({ notifyOnError: false }));
    } catch {
      // 静默：卡片按未授权渲染
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSync = useCallback(() => {
    setSyncing(true);
    void relaySync()
      .then(() => load())
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, [load]);

  const loggedIn = status?.loggedIn === true;
  const isMember = status?.isMember === true;
  const subs = status?.subscriptions ?? [];

  return (
    <div className="glass-surface rounded-2xl p-3.5" data-testid="membership-card">
      <div className="flex items-center gap-2.5">
        <Crown aria-hidden="true" className={cn('h-4 w-4', isMember ? 'text-warning' : 'text-muted-foreground')} />
        <span className="text-sm font-semibold text-foreground">中转站会员</span>
        {status ? (
          <span
            className={cn(
              'rounded-full border px-2 py-px text-[10px] font-medium',
              isMember ? 'border-success/40 bg-success/10 text-success'
                : loggedIn ? 'border-border bg-muted text-muted-foreground'
                  : 'border-warning/40 bg-warning/10 text-warning',
            )}
          >
            {isMember ? `${status.plan ?? '会员'} · 生效中` : loggedIn ? '无生效订阅' : '未授权'}
          </span>
        ) : null}
        <span className="flex-1" />
        {loggedIn ? (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            aria-label="同步会员状态"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {!status ? (
        <p className="mt-2 text-[11px] text-muted-foreground">状态加载中…</p>
      ) : loggedIn ? (
        <>
          {subs.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {subs.map((sub: RelaySubscriptionView, i: number) => (
                <li key={sub.id ?? i} className="flex items-center justify-between rounded-xl bg-card/60 px-3 py-1.5 text-xs">
                  <span className="truncate text-foreground">{sub.plan ?? '订阅'}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {sub.expiresAt ? `到期 ${sub.expiresAt.slice(0, 10)}` : sub.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">名下暂无生效中的订阅——到中转站购买后点右上角刷新。</p>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-2.5 text-[11px] text-primary hover:underline"
          >
            管理 Key / 模型 / 退出授权 →
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            授权登录中转站后，洗稿、媒体生成、知识库问答等会员功能即刻可用。
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-2.5 inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110"
          >
            前往授权登录
          </button>
        </>
      )}
    </div>
  );
}
