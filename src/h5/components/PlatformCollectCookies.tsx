'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cookie, Loader2 } from 'lucide-react';
import { deleteRssHubCookie, listRssHubCookies, putRssHubCookie } from '@/lib/api/apiClient';
import type { RssHubCookieProvider, RssHubCookieView } from '@/types';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';

const PROVIDERS: Array<{ id: RssHubCookieProvider; name: string; hint: string }> = [
  { id: 'douyin', name: '抖音', hint: '抖音订阅抓取 + 视频文案提取（yt-dlp 需登录态 cookie）' },
  { id: 'xiaohongshu', name: '小红书', hint: '小红书订阅抓取' },
  { id: 'weibo', name: '微博', hint: '微博订阅抓取' },
];

function ProviderCard({
  provider,
  view,
  onSaved,
}: {
  provider: { id: RssHubCookieProvider; name: string; hint: string };
  view: RssHubCookieView | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const configured = Boolean(view?.configured);

  const handleSave = useCallback(() => {
    const value = draft.trim();
    if (!value) {
      toast.info('请粘贴 Cookie');
      return;
    }
    setBusy(true);
    void putRssHubCookie(provider.id, { cookie: value })
      .then(() => {
        toast.success(`${provider.name} Cookie 已保存（加密落库）`);
        setDraft('');
        setOpen(false);
        onSaved();
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [draft, provider.id, provider.name, onSaved]);

  const handleClear = useCallback(() => {
    setBusy(true);
    void deleteRssHubCookie(provider.id)
      .then(() => {
        toast.success(`已清除${provider.name} Cookie`);
        onSaved();
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [provider.id, provider.name, onSaved]);

  return (
    <div className="glass-surface rounded-2xl p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{provider.name}</span>
        <span
          className={cn(
            'inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium',
            configured ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {configured ? '已配置' : '未配置'}
        </span>
        {configured && view?.maskedCookie ? (
          <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{view.maskedCookie}</span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{provider.hint}</p>

      {open ? (
        <div className="mt-2.5 space-y-2">
          <textarea
            rows={3}
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="粘贴浏览器开发者工具里的整段 Cookie…"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleSave}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 text-xs font-medium text-primary disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              保存
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setDraft(''); }}
              className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 text-xs font-medium text-primary"
          >
            <Cookie className="h-3.5 w-3.5" />
            {configured ? '更新 Cookie' : '粘贴 Cookie'}
          </button>
          {configured ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleClear}
              className="inline-flex h-9 items-center rounded-full border border-error/30 px-3.5 text-xs font-medium text-error disabled:opacity-50"
            >
              清除
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** 设置页「平台采集 Cookie」面板：抖音/小红书/微博 抓取与文案提取所需的登录态。 */
export default function PlatformCollectCookies() {
  const [views, setViews] = useState<RssHubCookieView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const list = await listRssHubCookies({ notifyOnError: false });
      setViews(Array.isArray(list) ? list : []);
    } catch {
      // 静默
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const viewByProvider = new Map(views.map((view) => [view.provider, view]));

  return (
    <section aria-label="平台采集 Cookie" className="glass-surface p-5">
      <div className="flex items-center gap-2">
        <Cookie aria-hidden="true" className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">平台采集 Cookie</h2>
          <p className="text-[11px] text-muted-foreground">抓取与视频文案提取所需的登录态，加密落库、只显示脱敏值</p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {loading ? (
          Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
          ))
        ) : (
          PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              view={viewByProvider.get(provider.id) ?? null}
              onSaved={() => void load(true)}
            />
          ))
        )}
      </div>
    </section>
  );
}
