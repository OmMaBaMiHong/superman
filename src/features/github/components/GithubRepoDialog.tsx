'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DIALOG_FORM_CONTENT_CLASS_NAME } from '@/lib/ui/designSystem';
import type { GithubRepoSubscription } from '@/types';
import { validateRepoInput } from '../utils/repoInput';

export interface GithubRepoDialogSubmit {
  repoInput?: string;
  title?: string;
  includePrerelease?: boolean;
  enabled?: boolean;
}

interface GithubRepoDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  repo?: GithubRepoSubscription | null;
  submitting: boolean;
  fieldError?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: GithubRepoDialogSubmit) => void;
}

export default function GithubRepoDialog({
  open,
  mode,
  repo,
  submitting,
  fieldError,
  onOpenChange,
  onSubmit,
}: GithubRepoDialogProps) {
  const [repoInput, setRepoInput] = useState('');
  const [title, setTitle] = useState('');
  const [includePrerelease, setIncludePrerelease] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === 'edit' && repo) {
      setRepoInput(repo.fullName);
      setTitle(repo.title && repo.title !== repo.fullName ? repo.title : '');
      setIncludePrerelease(repo.includePrerelease);
      setEnabled(repo.enabled);
    } else {
      setRepoInput('');
      setTitle('');
      setIncludePrerelease(false);
      setEnabled(true);
    }
    setLocalError(null);
  }, [open, mode, repo]);

  const dialogTitle = mode === 'edit' ? '编辑 GitHub 仓库' : '添加 GitHub 仓库';
  const dialogDescription =
    mode === 'edit'
      ? '修改标题、启用状态与预发布包含规则。'
      : '粘贴仓库地址即可订阅其 Release 更新。';

  const handleSubmit = () => {
    if (mode === 'create') {
      const validationError = validateRepoInput(repoInput);
      if (validationError) {
        setLocalError(validationError);
        return;
      }
    }

    const input: GithubRepoDialogSubmit = {};
    if (mode === 'create') {
      input.repoInput = repoInput.trim();
    }

    const trimmedTitle = title.trim();
    if (mode === 'edit') {
      input.title = trimmedTitle || undefined;
      input.enabled = enabled;
    } else if (trimmedTitle) {
      input.title = trimmedTitle;
    }
    input.includePrerelease = includePrerelease;

    onSubmit(input);
  };

  const effectiveError = localError ?? fieldError ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent
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
            <Label htmlFor="github-repo-input">仓库地址</Label>
            <Input
              id="github-repo-input"
              value={repoInput}
              disabled={mode === 'edit'}
              placeholder="facebook/react 或 https://github.com/facebook/react"
              onChange={(event) => {
                setRepoInput(event.target.value);
                if (localError) {
                  setLocalError(null);
                }
              }}
            />
            {mode === 'create' ? (
              <p className="text-[11px] text-muted-foreground">
                仅支持公开仓库，私有仓库需先在下方配置 Token。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="github-repo-title">自定义标题（可选）</Label>
            <Input
              id="github-repo-title"
              value={title}
              placeholder="留空则使用 owner/repo"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="github-repo-prerelease">包含预发布版本</Label>
            <Switch
              id="github-repo-prerelease"
              checked={includePrerelease}
              onCheckedChange={setIncludePrerelease}
            />
          </div>

          {mode === 'edit' ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="github-repo-enabled">启用</Label>
              <Switch id="github-repo-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          ) : null}

          {effectiveError ? <p className="text-[11px] text-destructive">{effectiveError}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={submitting} onClick={handleSubmit}>
            {submitting ? '保存中…' : mode === 'edit' ? '保存' : '添加仓库'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
