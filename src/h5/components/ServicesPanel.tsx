'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  getServicesStatus, restartSauExecutor, restartTrendRadar, saveServicesConfig,
  type ServicesStatus,
} from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';

/**
 * 「服务与同步」面板（P2e-5）：调度器/外部进程的运行状态、开关与重启。
 * 开关存 DB 热切换（免重启）；keeper 探活拉起的外部进程随 DSH 退出收掉
 * （服务器部署后由 docker-compose 接管）。
 */

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-error')}
    />
  );
}

function Toggle({
  checked, disabled, onChange, label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
          checked ? 'left-[1.375rem]' : 'left-0.5',
        )}
      />
    </button>
  );
}

export default function ServicesPanel() {
  const [status, setStatus] = useState<ServicesStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await getServicesStatus({ notifyOnError: false }));
    } catch {
      // 静默：面板显示为未知态
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (
    key: 'schedulerEnabled' | 'trendRadarKeeper' | 'sauKeeper',
    next: boolean,
    label: string,
  ) => {
    setBusy(key);
    try {
      await saveServicesConfig({ [key]: next });
      toast.success(`${label}已${next ? '开启' : '关闭'}${key === 'schedulerEnabled' ? '（即时生效）' : ''}`);
      await load();
    } catch {
      // apiClient 已统一 toast
    } finally {
      setBusy(null);
    }
  }, [load]);

  const restart = useCallback(async (
    kind: 'trendradar' | 'sau',
  ) => {
    setBusy(kind);
    try {
      if (kind === 'trendradar') {
        await restartTrendRadar();
        toast.success('TrendRadar 已重启，新一轮抓取开始');
      } else {
        await restartSauExecutor();
        toast.success('SAU 执行器正在重启，几秒后恢复在线');
      }
      setTimeout(() => { void load(); }, 2500);
    } catch {
      // apiClient 已统一 toast
    } finally {
      setBusy(null);
    }
  }, [load]);

  // 字段级兜底：后端/代理响应缺字段时不崩面板（与 stats 同款纪律）
  const scheduler = status?.scheduler ?? { enabled: false, running: false };
  const trendRadar = status?.trendRadar ?? { keeperEnabled: true, alive: false, pid: null };
  const sau = status?.sau ?? { keeperEnabled: true, online: false };

  return (
    <div className="space-y-3" data-testid="services-panel">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        服务与同步
      </h3>

      {!status ? (
        <p className="px-1 text-xs text-muted-foreground">状态加载中…</p>
      ) : (
        <>
          {/* 调度器总开关 */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5">
            <StatusDot ok={scheduler.running} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">定时调度器</span>
              <span className="block text-[11px] text-muted-foreground">
                {scheduler.running ? '运行中 · 采集 60s / 热点同步 30min / 评论 6h' : '已停止（采集与自动同步全部暂停）'}
              </span>
            </span>
            <Toggle
              label="定时调度器"
              checked={scheduler.enabled}
              disabled={busy === 'schedulerEnabled'}
              onChange={(next) => void toggle('schedulerEnabled', next, '定时调度器')}
            />
          </div>

          {/* TrendRadar */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5">
            <StatusDot ok={trendRadar.alive} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                TrendRadar 热榜源{trendRadar.alive ? '' : ' · 未运行'}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {trendRadar.alive ? `运行中（pid ${trendRadar.pid}）` : '未运行，keeper 开启时会自动拉起'}
              </span>
            </span>
            <button
              type="button"
              aria-label="重启 TrendRadar"
              disabled={busy === 'trendradar'}
              onClick={() => void restart('trendradar')}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', busy === 'trendradar' && 'animate-spin')} aria-hidden="true" />
              重启
            </button>
            <Toggle
              label="TrendRadar 自动拉起"
              checked={trendRadar.keeperEnabled}
              disabled={busy === 'trendRadarKeeper'}
              onChange={(next) => void toggle('trendRadarKeeper', next, 'TrendRadar 自动拉起')}
            />
          </div>

          {/* SAU 执行器 */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5">
            <StatusDot ok={sau.online} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                SAU 发布执行器{sau.online ? '' : ' · 离线'}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {sau.online ? '在线（扫码授权 / 视频发布可用）' : '离线，keeper 开启时会自动拉起'}
              </span>
            </span>
            <button
              type="button"
              aria-label="重启 SAU 执行器"
              disabled={busy === 'sau'}
              onClick={() => void restart('sau')}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', busy === 'sau' && 'animate-spin')} aria-hidden="true" />
              重启
            </button>
            <Toggle
              label="SAU 自动拉起"
              checked={sau.keeperEnabled}
              disabled={busy === 'sauKeeper'}
              onChange={(next) => void toggle('sauKeeper', next, 'SAU 自动拉起')}
            />
          </div>

          <p className="px-1 text-[11px] text-muted-foreground">
            keeper 拉起的进程随 DSH 一起退出；电脑重启后打开 DSH 会自动恢复。
          </p>
        </>
      )}
    </div>
  );
}
