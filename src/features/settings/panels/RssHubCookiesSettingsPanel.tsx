'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RssHubCookieProvider, RssHubCookieView } from '@/types';
import {
  runImmediateFailure,
  runImmediateSuccess,
} from '@/features/notifications/userOperationNotifier';
import { useRssHubCookies } from '@/features/rsshub/hooks/useRssHubCookies';
import {
  getRssHubCookieMeta,
  RSSHUB_COOKIE_PROVIDERS,
} from '@/features/rsshub/utils/rssHubCookieMeta';

function resolveDisplayName(provider: RssHubCookieProvider, view: RssHubCookieView | null): string {
  return view?.displayName || getRssHubCookieMeta(provider).displayName;
}

function formatDateTime(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 「平台 Cookie」设置分区：为内嵌 RSSHub 提供登录态以绕过反爬。
 *
 * 与「三方授权」分区版式一致：卡片列表 + 状态 badge + 二次确认。
 * 本面板同样**不持有明文**——接口只回打码值，落库加密由服务端负责，
 * 明文仅在输入框内存在一次，提交后立即清空。
 */
export default function RssHubCookiesSettingsPanel() {
  const { cookies, loading, saveCookie, clearCookie } = useRssHubCookies();

  const [draft, setDraft] = useState<Partial<Record<RssHubCookieProvider, string>>>({});
  const [busyProvider, setBusyProvider] = useState<RssHubCookieProvider | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<RssHubCookieProvider | null>(null);
  const [clearing, setClearing] = useState(false);

  const viewByProvider = useMemo(
    () => new Map(cookies.map((view) => [view.provider, view])),
    [cookies],
  );

  const handleDraftChange = useCallback(
    (provider: RssHubCookieProvider, value: string) => {
      setDraft((current) => ({ ...current, [provider]: value }));
      if (fieldError) {
        setFieldError(null);
      }
    },
    [fieldError],
  );

  const handleSave = useCallback(
    async (provider: RssHubCookieProvider) => {
      const value = (draft[provider] ?? '').trim();
      const displayName = resolveDisplayName(provider, viewByProvider.get(provider) ?? null);
      if (!value) {
        setFieldError('请输入 Cookie');
        return;
      }

      setBusyProvider(provider);
      setFieldError(null);
      try {
        await saveCookie(provider, { cookie: value });
        runImmediateSuccess({ actionKey: 'rsshub.cookie.save', context: { displayName } });
        setDraft((current) => ({ ...current, [provider]: '' }));
      } catch (err) {
        const message = err instanceof Error ? err.message : '保存失败';
        setFieldError(message);
        runImmediateFailure({ actionKey: 'rsshub.cookie.save', err, context: { displayName } });
      } finally {
        setBusyProvider(null);
      }
    },
    [draft, saveCookie, viewByProvider],
  );

  const handleClearConfirm = useCallback(async () => {
    if (clearTarget === null) {
      return;
    }

    const provider = clearTarget;
    const displayName = resolveDisplayName(provider, viewByProvider.get(provider) ?? null);
    setClearing(true);
    try {
      await clearCookie(provider);
      runImmediateSuccess({ actionKey: 'rsshub.cookie.clear', context: { displayName } });
      setClearTarget(null);
    } catch (err) {
      runImmediateFailure({ actionKey: 'rsshub.cookie.clear', err, context: { displayName } });
    } finally {
      setClearing(false);
    }
  }, [clearTarget, clearCookie, viewByProvider]);

  return (
    <>
      <section className="space-y-3 rounded-lg border border-border bg-background p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-foreground">平台 Cookie</h3>
          <p className="text-xs text-muted-foreground">
            部分平台（如抖音）抓取时需要登录态。填入浏览器登录后的 Cookie 即可解锁对应订阅。
            Cookie 加密落库，仅用于内嵌 RSSHub 抓取时注入，接口与页面永不回显明文。
          </p>
        </div>

        {loading ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            加载中…
          </div>
        ) : (
          <div className="space-y-3">
            {RSSHUB_COOKIE_PROVIDERS.map((provider) => {
              const view = viewByProvider.get(provider) ?? null;
              const meta = getRssHubCookieMeta(provider);
              const busy = busyProvider === provider;
              const value = draft[provider] ?? '';

              return (
                <div
                  key={provider}
                  className="space-y-3 rounded-xl border border-border/80 bg-card/70 p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{meta.displayName}</p>
                        {view?.configured ? (
                          <span className="inline-flex items-center rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                            已配置
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            未配置
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{meta.summary}</p>
                    </div>
                  </div>

                  {view?.configured ? (
                    <div className="space-y-1">
                      <p className="truncate font-mono text-[12px] text-muted-foreground">
                        {view.maskedCookie ?? ''}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        更新于 {formatDateTime(view.updatedAt)}
                        {view.remark ? ` · ${view.remark}` : ''}
                      </p>
                    </div>
                  ) : null}

                  <ul className="list-disc space-y-0.5 rounded-lg bg-muted/30 px-5 py-2 text-[11px] text-muted-foreground">
                    {meta.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>

                  <div className="space-y-2">
                    <Label htmlFor={`rsshub-cookie-${provider}`}>Cookie</Label>
                    <Textarea
                      id={`rsshub-cookie-${provider}`}
                      autoComplete="off"
                      spellCheck={false}
                      rows={3}
                      placeholder="粘贴浏览器开发者工具中复制的整段 Cookie…"
                      value={value}
                      onChange={(event) => handleDraftChange(provider, event.target.value)}
                    />
                    {fieldError ? (
                      <p className="text-[11px] text-destructive">{fieldError}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || clearing}
                      onClick={() => void handleSave(provider)}
                    >
                      {busy ? '保存中…' : '保存'}
                    </Button>
                    {view?.configured ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || clearing}
                        onClick={() => setClearTarget(provider)}
                      >
                        清除
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AlertDialog
        open={clearTarget !== null}
        onOpenChange={(open) => {
          if (!open && !clearing) {
            setClearTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清除平台 Cookie</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {clearTarget !== null
                ? `确定清除${resolveDisplayName(
                    clearTarget,
                    viewByProvider.get(clearTarget) ?? null,
                  )}的 Cookie？清除后订阅该平台时需重新配置。`
                : '确定清除这个平台的 Cookie？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing} onClick={() => setClearTarget(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/92"
              onClick={(event) => {
                event.preventDefault();
                void handleClearConfirm();
              }}
            >
              {clearing ? '清除中…' : '确认清除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
