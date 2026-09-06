'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  createPlatformAccount,
  deletePlatformAccount,
  listPlatformAccounts,
  verifyPlatformAccount,
  type AccountPlatform,
  type PlatformAccount,
} from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { ACCOUNT_PLATFORM_META, formatRelativeTime } from '../lib/accountPlatforms';
import AddAccountSheet from './AddAccountSheet';

const STATUS_META: Record<PlatformAccount['status'], { label: string; dotClass: string; textClass: string }> = {
  active: { label: '已验证', dotClass: 'bg-success', textClass: 'text-success' },
  expired: { label: '已过期', dotClass: 'bg-warning', textClass: 'text-warning' },
  error: { label: '异常', dotClass: 'bg-error', textClass: 'text-error' },
};

function AccountCard({
  account,
  verifying,
  onVerify,
  onDelete,
}: {
  account: PlatformAccount;
  verifying: boolean;
  onVerify: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const meta = ACCOUNT_PLATFORM_META[account.platform];
  const status = STATUS_META[account.status] ?? STATUS_META.error;

  return (
    <div data-testid="account-card" className="gov-card p-4 [--gov-accent:var(--glass-border)]">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">{meta.icon}</span>
        <span className="text-sm font-semibold text-foreground">{meta.name}</span>
        <span className="truncate text-[12px] text-muted-foreground">{account.accountName || '未命名'}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', status.dotClass)} />
          <span className={cn('text-[11px] font-medium', status.textClass)}>{status.label}</span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
        <span data-testid="credential-masked">{account.credentialMasked}</span>
        <span aria-hidden="true">·</span>
        <span>{formatRelativeTime(account.lastVerifiedAt)}</span>
        {!meta.supported ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-muted-foreground/70">待 P2e-2/3</span>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5">
        <button
          type="button"
          disabled={verifying}
          onClick={onVerify}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5',
            'text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
          {verifying ? '验证中…' : '验证连通'}
        </button>
        {confirmingDelete ? (
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-error">删除凭据？</span>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete();
              }}
              className="inline-flex h-8 items-center rounded-full border border-error/40 bg-error/10 px-2.5 text-[11px] font-medium text-error"
            >
              确认
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="inline-flex h-8 items-center rounded-full border border-border px-2.5 text-[11px] text-muted-foreground"
            >
              取消
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="删除账号"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-error/30 text-error/80 transition-colors duration-150 hover:bg-error/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** 设置页「发布平台授权」面板：账号列表 + 添加 + 验证 + 删除。 */
export default function PlatformAccountsPanel() {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // 打开设置页自动刷新一次列表
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await listPlatformAccounts(undefined, { notifyOnError: false });
      setAccounts(result.items);
    } catch {
      // 静默
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(
    (input: {
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
          void load(true);
        })
        .catch(() => {})
        .finally(() => setSubmitting(false));
    },
    [load],
  );

  const handleVerify = useCallback(
    (account: PlatformAccount) => {
      setVerifyingId(account.id);
      void verifyPlatformAccount(account.id)
        .then((result) => {
          if (result.verified) {
            toast.success(`「${account.accountName || ACCOUNT_PLATFORM_META[account.platform].name}」验证通过`);
          } else {
            toast.error(result.reason ?? '验证失败');
          }
          void load(true);
        })
        .catch(() => {})
        .finally(() => setVerifyingId(null));
    },
    [load],
  );

  const handleDelete = useCallback(
    (account: PlatformAccount) => {
      void deletePlatformAccount(account.id)
        .then(() => {
          toast.success('已删除');
          void load(true);
        })
        .catch(() => {});
    },
    [load],
  );

  return (
    <section aria-label="发布平台授权" className="glass-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound aria-hidden="true" className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">发布平台授权</h2>
            <p className="text-[11px] text-muted-foreground">凭据加密落库，只显示脱敏值</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className={cn(
            'inline-flex h-9 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3.5',
            'text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          添加账号
        </button>
      </div>

      <div className="mt-4 space-y-2.5">
        {loading ? (
          Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
          ))
        ) : accounts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
            还没有平台账号。添加公众号授权后，草稿可以一键发布到公众号草稿箱。
          </p>
        ) : (
          accounts.map((account) => (
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

      <AddAccountSheet
        open={addOpen}
        submitting={submitting}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
      />
    </section>
  );
}
