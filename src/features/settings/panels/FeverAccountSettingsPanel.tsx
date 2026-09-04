'use client';

import { useCallback, useEffect, useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  createFeverAccount,
  deleteFeverAccount,
  listFeverAccounts,
  syncFeverAccountNow,
  type FeverAccountDto,
  updateFeverAccountSettings,
} from '@/lib/api/apiClient';
import { DIALOG_FORM_CONTENT_CLASS_NAME } from '@/lib/ui/designSystem';
import {
  runImmediateFailure,
  runImmediateSuccess,
} from '../../notifications/userOperationNotifier';
import { useAppStore } from '../../../store/appStore';

type AccountDialogMode = 'create' | 'edit' | null;

type AccountFormDraft = {
  id: string | null;
  baseUrl: string;
  username: string;
  apiKey: string;
  enabled: boolean;
  autoSyncIntervalMinutes: number;
};

const DEFAULT_FORM_DRAFT: AccountFormDraft = {
  id: null,
  baseUrl: '',
  username: '',
  apiKey: '',
  enabled: true,
  autoSyncIntervalMinutes: 30,
};

function buildDraftFromAccount(account: FeverAccountDto): AccountFormDraft {
  return {
    id: account.id,
    baseUrl: account.baseUrl,
    username: account.username,
    apiKey: '',
    enabled: account.enabled,
    autoSyncIntervalMinutes: account.autoSyncEnabled ? account.autoSyncIntervalMinutes : 0,
  };
}

export default function FeverAccountSettingsPanel() {
  const [accounts, setAccounts] = useState<FeverAccountDto[]>([]);
  const [dialogMode, setDialogMode] = useState<AccountDialogMode>(null);
  const [formDraft, setFormDraft] = useState<AccountFormDraft>(DEFAULT_FORM_DRAFT);
  const [submittingDialog, setSubmittingDialog] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  const activeDeleteAccount =
    deleteAccountId ? accounts.find((account) => account.id === deleteAccountId) ?? null : null;
  const editingAccount =
    dialogMode === 'edit' && formDraft.id
      ? accounts.find((account) => account.id === formDraft.id) ?? null
      : null;
  const dialogOpen = dialogMode !== null;
  const dialogTitle = dialogMode === 'edit' ? '编辑 Fever 服务' : '添加 Fever 服务';
  const dialogDescription =
    dialogMode === 'edit'
      ? '修改服务连接、启用状态和同步间隔。'
      : '填写连接信息后即可把远端订阅同步到本地。';
  const dialogSubmitLabel = dialogMode === 'edit' ? '保存服务设置' : '保存服务';
  const passwordPlaceholder =
    dialogMode === 'edit' ? '留空表示不修改' : '请输入 API 密钥';

  const reloadAccounts = useCallback(async () => {
    const nextAccounts = await listFeverAccounts({ notifyOnError: false });
    setAccounts(nextAccounts);
  }, []);

  const reloadCurrentSnapshot = useCallback(async () => {
    const { selectedView, loadSnapshot } = useAppStore.getState();
    await loadSnapshot({ view: selectedView });
  }, []);

  useEffect(() => {
    // 面板打开后立即拉取远端账号，保证卡片状态与服务端一致。
    void reloadAccounts();
  }, [reloadAccounts]);

  const formatSyncTime = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const waitForSyncResult = async (
    accountId: string,
    previousState: { lastSyncAt: string | null; lastError: string | null },
  ) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const nextAccounts = await listFeverAccounts({ notifyOnError: false });
      setAccounts(nextAccounts);

      const nextAccount = nextAccounts.find((account) => account.id === accountId);
      const hasNewError = nextAccount?.lastError && nextAccount.lastError !== previousState.lastError;
      const hasNewSyncTime =
        nextAccount?.lastSyncAt && nextAccount.lastSyncAt !== previousState.lastSyncAt;
      if (hasNewError || hasNewSyncTime) {
        return nextAccount;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return null;
  };

  const resetDialog = () => {
    setDialogMode(null);
    setFormDraft(DEFAULT_FORM_DRAFT);
  };

  const updateFormDraft = (patch: Partial<AccountFormDraft>) => {
    setFormDraft((current) => ({
      ...current,
      ...patch,
    }));
  };

  const openCreateDialog = () => {
    setFormDraft(DEFAULT_FORM_DRAFT);
    setDialogMode('create');
  };

  const openEditDialog = (account: FeverAccountDto) => {
    // 编辑时用远端最新值覆盖本地草稿，避免残留上一次输入。
    setFormDraft(buildDraftFromAccount(account));
    setDialogMode('edit');
  };

  const normalizeInterval = (value: number): number => {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1440, Math.round(value)));
  };

  const saveAccountToList = (updated: FeverAccountDto) => {
    setAccounts((currentAccounts) => {
      const existed = currentAccounts.some((account) => account.id === updated.id);
      if (!existed) {
        return [...currentAccounts, updated];
      }

      return currentAccounts.map((account) => (account.id === updated.id ? updated : account));
    });
  };

  const handleSubmitDialog = async () => {
    const normalizedInterval = normalizeInterval(formDraft.autoSyncIntervalMinutes);

    setSubmittingDialog(true);

    try {
      if (dialogMode === 'create') {
        const created = await createFeverAccount(
          {
            baseUrl: formDraft.baseUrl.trim(),
            username: formDraft.username.trim(),
            apiKey: formDraft.apiKey.trim(),
            enabled: formDraft.enabled,
            autoSyncIntervalMinutes: normalizedInterval,
          },
          { notifyOnError: false },
        );
        saveAccountToList(created);
        resetDialog();
        runImmediateSuccess({
          actionKey: 'fever.sync',
          context: { outcome: 'settings_saved' },
        });
        return;
      }

      if (dialogMode === 'edit' && formDraft.id) {
        const updated = await updateFeverAccountSettings(
          {
            id: formDraft.id,
            baseUrl: formDraft.baseUrl.trim(),
            username: formDraft.username.trim(),
            apiKey: formDraft.apiKey.trim(),
            enabled: formDraft.enabled,
            autoSyncIntervalMinutes: normalizedInterval,
          },
          { notifyOnError: false },
        );
        saveAccountToList(updated);
        resetDialog();
        runImmediateSuccess({
          actionKey: 'fever.sync',
          context: { outcome: 'settings_saved' },
        });
      }
    } catch (err) {
      runImmediateFailure({
        actionKey: 'fever.sync',
        err,
      });
    } finally {
      setSubmittingDialog(false);
    }
  };

  const handleToggleAccountEnabled = async (account: FeverAccountDto, enabled: boolean) => {
    if (togglingAccountId) {
      return;
    }

    setTogglingAccountId(account.id);

    try {
      const updated = await updateFeverAccountSettings(
        {
          id: account.id,
          baseUrl: account.baseUrl,
          username: account.username,
          enabled,
          autoSyncIntervalMinutes: account.autoSyncEnabled ? account.autoSyncIntervalMinutes : 0,
        },
        { notifyOnError: false },
      );
      saveAccountToList(updated);
      // 账号启停会直接影响左栏是否显示对应 Fever 投影源，成功后立即刷新快照。
      await reloadCurrentSnapshot();
      runImmediateSuccess({
        actionKey: 'fever.sync',
        context: { outcome: 'settings_saved' },
      });
    } catch (err) {
      runImmediateFailure({
        actionKey: 'fever.sync',
        err,
      });
    } finally {
      setTogglingAccountId(null);
    }
  };

  const handleSyncAccount = async (accountId: string) => {
    if (syncingAccountId) {
      return;
    }

    const currentAccount = accounts.find((account) => account.id === accountId) ?? null;
    setSyncingAccountId(accountId);

    try {
      const result = await syncFeverAccountNow(accountId, { notifyOnError: false });
      if (result.queued) {
        const terminalAccount = await waitForSyncResult(accountId, {
          lastSyncAt: currentAccount?.lastSyncAt ?? null,
          lastError: currentAccount?.lastError ?? null,
        });
        if (!terminalAccount) {
          runImmediateFailure({
            actionKey: 'fever.sync',
            err: 'Fever 同步仍在进行中，请稍后刷新查看结果',
          });
          return;
        }
        await reloadCurrentSnapshot();
        runImmediateSuccess({ actionKey: 'fever.sync', context: { outcome: 'synced' } });
        return;
      }

      if (result.reason === 'already_enqueued') {
        const terminalAccount = await waitForSyncResult(accountId, {
          lastSyncAt: currentAccount?.lastSyncAt ?? null,
          lastError: currentAccount?.lastError ?? null,
        });
        if (!terminalAccount) {
          runImmediateFailure({
            actionKey: 'fever.sync',
            err: 'Fever 同步仍在进行中，请稍后刷新查看结果',
          });
          return;
        }
        await reloadCurrentSnapshot();
        runImmediateSuccess({
          actionKey: 'fever.sync',
          context: { outcome: 'already_enqueued' },
        });
        return;
      }

      runImmediateFailure({
        actionKey: 'fever.sync',
        err: '暂时无法加入同步队列，请稍后重试',
      });
    } catch (err) {
      runImmediateFailure({
        actionKey: 'fever.sync',
        err,
      });
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteAccountId) {
      return;
    }

    setDeletingAccountId(deleteAccountId);

    try {
      const result = await deleteFeverAccount(deleteAccountId, { notifyOnError: false });
      if (!result.deleted) {
        runImmediateFailure({
          actionKey: 'fever.sync',
          err: 'Fever 服务不存在或已被删除',
        });
        return;
      }
      // 删除服务后同步刷新左栏，确保投影的 fever 源立即消失。
      await reloadCurrentSnapshot();
      await reloadAccounts();
      setDeleteAccountId(null);
      runImmediateSuccess({
        actionKey: 'fever.sync',
        context: { outcome: 'deleted' },
      });
    } catch (err) {
      runImmediateFailure({
        actionKey: 'fever.sync',
        err,
      });
    } finally {
      setDeletingAccountId(null);
    }
  };

  return (
    <>
      <section className="space-y-3 rounded-lg border border-border bg-background p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Fever 服务</h3>
            <p className="text-xs text-muted-foreground">统一管理远端服务、启用状态与同步节奏。</p>
          </div>
          <Button type="button" size="compact" onClick={openCreateDialog}>
            添加 Fever 服务
          </Button>
        </div>

        <div className="grid gap-2.5">
          {accounts.map((account) => (
            <article
              key={account.id}
              className="w-full rounded-xl border border-border/80 bg-card/70 px-3 py-2.5 shadow-sm"
            >
              <div className="flex items-stretch justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{account.username}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{account.baseUrl}</p>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    <span>上次同步 </span>
                    <span className="text-foreground">
                      {account.lastSyncAt ? formatSyncTime(account.lastSyncAt) : '尚未同步'}
                    </span>
                  </div>

                  {account.lastError ? (
                    <div className="inline-flex max-w-full items-center rounded-md border border-destructive/20 bg-destructive/8 px-2 py-1 text-[11px] text-destructive">
                      {account.lastError}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end justify-between gap-3">
                  <Switch
                    aria-label={`${account.username} 启用状态`}
                    checked={account.enabled}
                    disabled={togglingAccountId === account.id}
                    onCheckedChange={(checked) => {
                      void handleToggleAccountEnabled(account, checked);
                    }}
                  />
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`编辑 ${account.username}`}
                      onClick={() => {
                        openEditDialog(account);
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDeleteAccountId(account.id);
                      }}
                    >
                      删除服务
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={syncingAccountId === account.id}
                      onClick={() => {
                        void handleSyncAccount(account.id);
                      }}
                    >
                      {syncingAccountId === account.id ? '同步中…' : '立即同步'}
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}

          {accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
              暂无 Fever 服务，点击右上角按钮添加。
            </div>
          ) : null}
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !submittingDialog) {
            resetDialog();
          }
        }}
      >
        <DialogContent
          closeLabel={dialogMode === 'edit' ? '关闭编辑 Fever 服务' : '关闭添加 Fever 服务'}
          className={DIALOG_FORM_CONTENT_CLASS_NAME}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="fever-service-base-url">fever 地址</Label>
              <Input
                id="fever-service-base-url"
                type="url"
                value={formDraft.baseUrl}
                placeholder="https://reader.example.com"
                onChange={(event) => {
                  updateFormDraft({ baseUrl: event.target.value });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fever-service-username">用户名</Label>
              <Input
                id="fever-service-username"
                value={formDraft.username}
                placeholder="your-account"
                onChange={(event) => {
                  updateFormDraft({ username: event.target.value });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fever-service-password">密码</Label>
              <Input
                id="fever-service-password"
                type="password"
                value={formDraft.apiKey}
                // 编辑态保留原密码，因此只在编辑时提示可留空。
                placeholder={passwordPlaceholder}
                onChange={(event) => {
                  updateFormDraft({ apiKey: event.target.value });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fever-service-auto-sync-interval">同步间隔（分钟）</Label>
              <Input
                id="fever-service-auto-sync-interval"
                aria-label="同步间隔（分钟）"
                type="number"
                min={0}
                max={1440}
                step={5}
                value={String(formDraft.autoSyncIntervalMinutes)}
                onChange={(event) => {
                  updateFormDraft({
                    autoSyncIntervalMinutes: Number(event.target.value) || 0,
                  });
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="fever-service-enabled">启用</Label>
              <Switch
                id="fever-service-enabled"
                aria-label="启用该 Fever 服务"
                checked={formDraft.enabled}
                onCheckedChange={(checked) => {
                  updateFormDraft({ enabled: checked });
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetDialog();
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={submittingDialog || (dialogMode === 'edit' && !editingAccount)}
              onClick={() => {
                void handleSubmitDialog();
              }}
            >
              {submittingDialog ? '保存中…' : dialogSubmitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteAccountId)}
        onOpenChange={(open) => {
          if (!open && !deletingAccountId) {
            setDeleteAccountId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除 Fever 服务</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {activeDeleteAccount
                ? `确定删除 Fever 服务「${activeDeleteAccount.username}」？`
                : '确定删除这个 Fever 服务？'}
              删除后会删除该 Fever 服务下的所有 fever 源，并立即从左栏移除；该 Fever 服务及其 fever 源均无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingAccountId)}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/92"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteAccount();
              }}
            >
              {deletingAccountId ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
