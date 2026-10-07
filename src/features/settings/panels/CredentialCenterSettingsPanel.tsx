'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { getCredentialCenter, type CredentialCenter } from '@/lib/api/apiClient';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

const STATUS_LABEL: Record<'active' | 'expired' | 'error', string> = {
  active: '有效',
  expired: '已过期',
  error: '异常',
};

/**
 * 「授权与凭证」总览：按平台聚合展示所有凭据（发布授权 + 采集 Cookie）状态。
 *
 * 只读总览——具体增删在下方对应分区（平台 Cookie）与平台账号面板里操作。
 * 数据来自 `/api/credential-center`，永不回显明文/密文，只有打码值。
 */
export default function CredentialCenterSettingsPanel() {
  const [center, setCenter] = useState<CredentialCenter | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setCenter(await getCredentialCenter({ notifyOnError: false }));
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <KeyRound aria-hidden="true" className="h-4 w-4 text-primary" />
          授权与凭证
        </h3>
        <p className="text-xs text-muted-foreground">
          按平台聚合：发布授权（扫码登录 / AppSecret）与采集 Cookie（抓取 / 文案提取）。凭据加密落库，只显示脱敏值。
        </p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
          加载中…
        </div>
      ) : !center || center.platforms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
          暂无平台凭据
        </div>
      ) : (
        <div className="space-y-2.5">
          {center.platforms.map((platform) => (
            <div key={platform.platform} className="rounded-xl border border-border/80 bg-card/70 p-3">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-lg">{platform.icon}</span>
                <span className="text-sm font-semibold text-foreground">{platform.name}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {platform.slots.map((slot) => (
                  <div key={slot.purpose} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                    <span
                      className={
                        slot.configured
                          ? 'inline-flex h-5 items-center rounded-full border border-success/20 bg-success/10 px-2 text-[11px] font-medium text-success'
                          : 'inline-flex h-5 items-center rounded-full border border-border/70 bg-muted px-2 text-[11px] font-medium text-muted-foreground'
                      }
                    >
                      {slot.configured ? STATUS_LABEL[slot.status] : '未配置'}
                    </span>
                    <span className="text-foreground/90">{slot.label}</span>
                    {slot.capabilities.length > 0 ? (
                      <span className="text-[11px] text-muted-foreground">· {slot.capabilities.join('/')}</span>
                    ) : null}
                    {slot.configured ? (
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        {slot.masked || '****'}
                        {slot.updatedAt ? ` · ${formatDateTime(slot.updatedAt)}` : ''}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
