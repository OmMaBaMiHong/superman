'use client';

import { useCallback, useState } from 'react';
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
import { ApiError } from '@/lib/api/apiClient';
import type { GithubRepoSubscription } from '@/types';
import { runImmediateFailure, runImmediateSuccess } from '@/features/notifications/userOperationNotifier';
import { useAppStore } from '@/store/appStore';
import { useGithubRepos } from '@/features/github/hooks/useGithubRepos';
import GithubRepoDialog, { type GithubRepoDialogSubmit } from '@/features/github/components/GithubRepoDialog';
import GithubRepoList from '@/features/github/components/GithubRepoList';
import GithubTokenField from '@/features/github/components/GithubTokenField';

type DialogMode = 'create' | 'edit' | null;

export default function GithubSettingsPanel() {
  const { repos, tokenStatus, loading, createRepo, updateRepo, removeRepo, refreshRepo, saveToken, clearToken } =
    useGithubRepos();

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingRepo, setEditingRepo] = useState<GithubRepoSubscription | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deleteRepo, setDeleteRepo] = useState<GithubRepoSubscription | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reloadSnapshot = useCallback(() => {
    const { selectedView, loadSnapshot } = useAppStore.getState();
    void loadSnapshot({ view: selectedView });
  }, []);

  const closeDialog = useCallback(() => {
    setDialogMode(null);
    setEditingRepo(null);
    setFieldError(null);
  }, []);

  const openCreate = useCallback(() => {
    setFieldError(null);
    setDialogMode('create');
  }, []);

  const openEdit = useCallback((repo: GithubRepoSubscription) => {
    setEditingRepo(repo);
    setFieldError(null);
    setDialogMode('edit');
  }, []);

  const handleSubmitDialog = useCallback(
    async (input: GithubRepoDialogSubmit) => {
      setSubmitting(true);
      setFieldError(null);
      try {
        if (dialogMode === 'create') {
          const created = await createRepo({
            repoInput: input.repoInput ?? '',
            includePrerelease: input.includePrerelease,
            title: input.title,
          });
          runImmediateSuccess({ actionKey: 'github.repo.create', context: { fullName: created.fullName } });
          closeDialog();
          reloadSnapshot();
          return;
        }

        if (dialogMode === 'edit' && editingRepo) {
          await updateRepo(editingRepo.id, {
            title: input.title,
            enabled: input.enabled,
            includePrerelease: input.includePrerelease,
          });
          runImmediateSuccess({ actionKey: 'github.repo.update' });
          closeDialog();
          reloadSnapshot();
        }
      } catch (err) {
        if (err instanceof ApiError && err.fields?.repoInput) {
          setFieldError(err.fields.repoInput);
          return;
        }
        runImmediateFailure({
          actionKey: dialogMode === 'edit' ? 'github.repo.update' : 'github.repo.create',
          err,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [dialogMode, editingRepo, createRepo, updateRepo, closeDialog, reloadSnapshot],
  );

  const handleRefresh = useCallback(
    async (repo: GithubRepoSubscription) => {
      if (refreshingId) {
        return;
      }

      setRefreshingId(repo.id);
      try {
        const result = await refreshRepo(repo.id);
        if (result.enqueued) {
          runImmediateSuccess({
            actionKey: 'github.repo.refresh',
            context: { outcome: result.reason === 'already_enqueued' ? 'already_enqueued' : 'queued' },
          });
        } else {
          runImmediateFailure({
            actionKey: 'github.repo.refresh',
            err: '暂时无法加入同步队列，请稍后重试',
          });
        }
      } catch (err) {
        runImmediateFailure({ actionKey: 'github.repo.refresh', err });
      } finally {
        setRefreshingId(null);
      }
    },
    [refreshingId, refreshRepo],
  );

  const handleDeleteCancel = useCallback(() => setDeleteRepo(null), []);
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteRepo) {
      return;
    }

    setDeletingId(deleteRepo.id);
    try {
      await removeRepo(deleteRepo.id);
      runImmediateSuccess({ actionKey: 'github.repo.delete' });
      setDeleteRepo(null);
      reloadSnapshot();
    } catch (err) {
      runImmediateFailure({ actionKey: 'github.repo.delete', err });
    } finally {
      setDeletingId(null);
    }
  }, [deleteRepo, removeRepo, reloadSnapshot]);

  const handleSaveToken = useCallback(
    async (token: string) => {
      try {
        await saveToken(token);
        runImmediateSuccess({ actionKey: 'github.token.save' });
      } catch (err) {
        if (err instanceof ApiError && err.fields?.token) {
          throw new Error(err.fields.token);
        }
        runImmediateFailure({ actionKey: 'github.token.save', err });
        throw err;
      }
    },
    [saveToken],
  );

  const handleClearToken = useCallback(async () => {
    try {
      await clearToken();
      runImmediateSuccess({ actionKey: 'github.token.clear' });
    } catch (err) {
      runImmediateFailure({ actionKey: 'github.token.clear', err });
    }
  }, [clearToken]);

  const dialogOpen = dialogMode !== null;

  return (
    <>
      <section className="space-y-3 rounded-lg border border-border bg-background p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">GitHub 仓库订阅</h3>
            <p className="text-xs text-muted-foreground">
              订阅公开仓库的 Release 更新，或在下方配置 Token 后订阅私有仓库。
            </p>
          </div>
          <Button type="button" size="compact" onClick={openCreate}>
            添加仓库
          </Button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            加载中…
          </div>
        ) : (
          <GithubRepoList
            repos={repos}
            refreshingId={refreshingId}
            onEdit={openEdit}
            onDelete={setDeleteRepo}
            onRefresh={handleRefresh}
          />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-background p-4">
        <h3 className="text-sm font-medium text-foreground">访问凭证</h3>
        <p className="text-xs text-muted-foreground">
          也可在「三方授权」分区通过 GitHub 一键授权，两者并存不冲突。
        </p>
        <GithubTokenField status={tokenStatus} onSave={handleSaveToken} onClear={handleClearToken} />
      </section>

      <GithubRepoDialog
        open={dialogOpen}
        mode={dialogMode ?? 'create'}
        repo={editingRepo}
        submitting={submitting}
        fieldError={fieldError}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        onSubmit={handleSubmitDialog}
      />

      <AlertDialog
        open={Boolean(deleteRepo)}
        onOpenChange={(open) => {
          if (!open) {
            handleDeleteCancel();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除仓库订阅</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {deleteRepo
                ? `确定删除 ${deleteRepo.fullName} 的订阅？已同步的文章会一并移除，且无法恢复。`
                : '确定删除这个仓库订阅？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)} onClick={handleDeleteCancel}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/92"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
            >
              {deletingId ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
