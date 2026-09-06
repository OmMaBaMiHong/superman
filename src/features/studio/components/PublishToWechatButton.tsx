'use client';

import { useCallback, useState } from 'react';
import { Check, Send } from 'lucide-react';
import {
  listPlatformAccounts,
  publishDraftToWechat,
  type PlatformAccount,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';

interface PublishToWechatButtonProps {
  draftId: string;
  /** 发布成功后回调（置本地已发布态 / 刷新列表）。 */
  onPublished?: () => void;
}

/**
 * 「发布到公众号」按钮（P2e-1b）：
 * - 无 wechat active 账号 → 置灰 + tooltip 指引去设置页
 * - 有账号 → 弹出选择（单账号预选）→ 确认发布 → toast + 已发布态
 */
export default function PublishToWechatButton({ draftId, onPublished }: PublishToWechatButtonProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accounts, setAccounts] = useState<PlatformAccount[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const noAccount = accounts !== null && accounts.length === 0;

  const openPicker = useCallback(() => {
    void listPlatformAccounts({ platform: 'wechat' }, { notifyOnError: false })
      .then((result) => {
        const active = result.items.filter((item) => item.status !== 'error');
        setAccounts(active);
        if (active.length === 1) setSelectedId(active[0].id);
        if (active.length > 0) setPickerOpen(true);
      })
      .catch(() => {});
  }, []);

  const handlePublish = useCallback(() => {
    if (!selectedId || publishing) return;
    setPublishing(true);
    void publishDraftToWechat(draftId, { accountId: selectedId })
      .then(() => {
        toast.success('已送入公众号草稿箱');
        setPublished(true);
        setPickerOpen(false);
        onPublished?.();
      })
      .catch(() => {
        // apiClient 已统一 toast 错误（含微信侧错误摘要）
      })
      .finally(() => setPublishing(false));
  }, [draftId, selectedId, publishing, onPublished]);

  if (published) {
    return (
      <span
        data-testid="published-badge"
        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-5 text-sm font-medium text-success"
      >
        <Check aria-hidden="true" className="h-4 w-4" />
        已发布到公众号
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="publish-to-wechat"
        disabled={noAccount}
        title={noAccount ? '先去设置页添加公众号授权' : '发布到公众号草稿箱'}
        onClick={openPicker}
        className={cn(
          'inline-flex h-11 items-center gap-1.5 rounded-full border px-5 text-sm font-medium transition-all duration-150 active:scale-[0.97]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
          noAccount
            ? 'cursor-not-allowed border-border text-muted-foreground/60'
            : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20',
        )}
      >
        <Send aria-hidden="true" className="h-4 w-4" />
        发布到公众号
      </button>

      <GlassDetailSheet open={pickerOpen} onClose={() => setPickerOpen(false)} ariaLabel="选择公众号账号">
        <div className="px-5 pb-6 pt-1 sm:px-7">
          <h2 className="text-base font-semibold text-foreground">选择公众号账号</h2>
          <div className="mt-3 space-y-2">
            {(accounts ?? []).map((account) => (
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
                <span aria-hidden="true">💬</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {account.accountName || '公众号'}
                  </span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {account.credentialMasked}
                  </span>
                </span>
                {selectedId === account.id ? (
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                ) : null}
              </button>
            ))}
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
              disabled={!selectedId || publishing}
              onClick={handlePublish}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5',
                'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <Send aria-hidden="true" className="h-4 w-4" />
              {publishing ? '发布中…' : '确认发布'}
            </button>
          </div>
        </div>
      </GlassDetailSheet>
    </>
  );
}
