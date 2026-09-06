'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, Check, Send } from 'lucide-react';
import {
  listPlatformAccounts,
  publishDraftToSauVideo,
  publishDraftToWechat,
  type AccountPlatform,
  type PlatformAccount,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { ACCOUNT_PLATFORM_META } from '@/h5/lib/accountPlatforms';

type PublishPlatform = Extract<AccountPlatform, 'wechat' | 'douyin' | 'xhs'>;

const PUBLISH_PLATFORMS: PublishPlatform[] = ['wechat', 'douyin', 'xhs'];

const PLATFORM_PUBLISH_HINT: Record<PublishPlatform, string> = {
  wechat: '送入公众号草稿箱，可在公众号后台人工发布',
  douyin: '即时发布，不可撤回',
  xhs: '即时发布，不可撤回（同账号限频：间隔 ≥30 分钟、每日 ≤5 条）',
};

interface PublishToWechatButtonProps {
  draftId: string;
  /** 发布成功后回调（置本地已发布态 / 刷新列表）。 */
  onPublished?: () => void;
}

/**
 * 发布按钮（P2e-1b 公众号 / P2e-2 抖音 / P2e-3 小红书）：
 * - 无可用账号 → 置灰 + tooltip 指引去设置页
 * - 弹出平台 + 账号选择（单平台单账号预选）→ 确认发布 → toast + 已发布态
 * - 抖音/小红书是即时发布（无草稿箱），sheet 显示红色二次确认文案
 */
export default function PublishToWechatButton({ draftId, onPublished }: PublishToWechatButtonProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [platform, setPlatform] = useState<PublishPlatform>('wechat');
  const [accounts, setAccounts] = useState<PlatformAccount[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videoSource, setVideoSource] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const isInstant = platform !== 'wechat';

  const loadAccounts = useCallback((target: PublishPlatform) => {
    void listPlatformAccounts({ platform: target }, { notifyOnError: false })
      .then((result) => {
        const active = result.items.filter((item) => item.status !== 'error');
        setAccounts(active);
        setSelectedId(active.length === 1 ? active[0].id : null);
      })
      .catch(() => {});
  }, []);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    loadAccounts(platform);
  }, [loadAccounts, platform]);

  const switchPlatform = useCallback((target: PublishPlatform) => {
    setPlatform(target);
    setSelectedId(null);
    loadAccounts(target);
  }, [loadAccounts]);

  const handlePublish = useCallback(() => {
    if (!selectedId || publishing) return;
    if (isInstant && !videoSource.trim()) {
      toast.error('请填写视频文件路径或视频 URL');
      return;
    }
    setPublishing(true);
    const request = isInstant
      ? publishDraftToSauVideo(draftId, {
          platform,
          accountId: selectedId,
          ...(videoSource.trim().startsWith('http')
            ? { videoUrl: videoSource.trim() }
            : { videoPath: videoSource.trim() }),
        }).then(() => `已发布到${ACCOUNT_PLATFORM_META[platform].name}`)
      : publishDraftToWechat(draftId, { accountId: selectedId }).then(() => '已送入公众号草稿箱');
    void request
      .then((message) => {
        toast.success(message);
        setPublished(true);
        setPickerOpen(false);
        onPublished?.();
      })
      .catch(() => {
        // apiClient 已统一 toast 错误（含平台侧错误摘要与限频提示）
      })
      .finally(() => setPublishing(false));
  }, [draftId, selectedId, publishing, isInstant, platform, videoSource, onPublished]);

  if (published) {
    return (
      <span
        data-testid="published-badge"
        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-5 text-sm font-medium text-success"
      >
        <Check aria-hidden="true" className="h-4 w-4" />
        已发布到{ACCOUNT_PLATFORM_META[platform].name}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="publish-to-wechat"
        title="发布到平台"
        onClick={openPicker}
        className={cn(
          'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5 text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
        )}
      >
        <Send aria-hidden="true" className="h-4 w-4" />
        发布
      </button>

      <GlassDetailSheet open={pickerOpen} onClose={() => setPickerOpen(false)} ariaLabel="选择发布平台与账号">
        <div className="px-5 pb-6 pt-1 sm:px-7">
          <h2 className="text-base font-semibold text-foreground">选择发布平台与账号</h2>

          {/* 平台三选一 */}
          <div role="radiogroup" aria-label="发布平台" className="mt-3 grid grid-cols-3 gap-2">
            {PUBLISH_PLATFORMS.map((id) => {
              const item = ACCOUNT_PLATFORM_META[id];
              const selected = platform === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => switchPlatform(id)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-medium transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    selected
                      ? 'border-primary/50 bg-primary/[0.08] text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  <span aria-hidden="true" className="text-lg">{item.icon}</span>
                  {item.name}
                </button>
              );
            })}
          </div>

          {/* 平台提示：抖音/小红书即时发布 → 红色二次确认 */}
          {isInstant ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-2xl border border-error/40 bg-error/10 px-3.5 py-2.5 text-[11px] leading-relaxed text-error">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {PLATFORM_PUBLISH_HINT[platform]}
            </p>
          ) : (
            <p className="mt-3 rounded-2xl border border-border/70 bg-card/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {PLATFORM_PUBLISH_HINT[platform]}
            </p>
          )}

          {/* 视频来源（即时平台必填） */}
          {isInstant ? (
            <div className="mt-3 space-y-1.5">
              <label htmlFor="publish-video-source" className="text-xs font-medium text-muted-foreground">
                视频文件路径或视频 URL
              </label>
              <input
                id="publish-video-source"
                type="text"
                value={videoSource}
                onChange={(event) => setVideoSource(event.target.value)}
                placeholder="执行器已有文件名 / 本机绝对路径 / https://…"
                className="h-11 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          ) : null}

          {/* 账号选择 */}
          <div className="mt-3 space-y-2">
            {accounts === null ? (
              <div className="h-16 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
            ) : accounts.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-[12px] text-muted-foreground">
                还没有可用的{ACCOUNT_PLATFORM_META[platform].name}账号，请先去设置页授权
              </p>
            ) : (
              accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedId === account.id}
                  onClick={() => setSelectedId(account.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    selectedId === account.id
                      ? 'border-primary/50 bg-primary/[0.08]'
                      : 'border-border hover:bg-accent/60',
                  )}
                >
                  <span aria-hidden="true">{ACCOUNT_PLATFORM_META[platform].icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {account.accountName || ACCOUNT_PLATFORM_META[platform].name}
                    </span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {account.credentialMasked}
                    </span>
                  </span>
                  {selectedId === account.id ? (
                    <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!selectedId || publishing || (isInstant && !videoSource.trim())}
              onClick={handlePublish}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-full border px-5',
                'text-sm font-medium transition-all duration-150 active:scale-[0.97]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-50',
                isInstant
                  ? 'border-error/40 bg-error/10 text-error hover:bg-error/20'
                  : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20',
              )}
            >
              <Send aria-hidden="true" className="h-4 w-4" />
              {publishing ? '发布中…' : isInstant ? '确认即时发布' : '确认发布'}
            </button>
          </div>
        </div>
      </GlassDetailSheet>
    </>
  );
}
