'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { GithubTokenStatus } from '@/types';

interface GithubTokenFieldProps {
  status: GithubTokenStatus | null;
  onSave: (token: string) => Promise<void>;
  onClear: () => Promise<void>;
}

/**
 * GitHub Token 输入 / 保存 / 清除 + 速率限制提示。
 * 明文仅在前端输入框存在一次，提交后立即清空；落库加密由服务端负责。
 */
export default function GithubTokenField({ status, onSave, onClear }: GithubTokenFieldProps) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status?.hasToken) {
      return;
    }
    setToken('');
  }, [status?.hasToken]);

  const handleSave = async () => {
    const value = token.trim();
    if (!value) {
      setError('请输入 GitHub Token');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      setToken('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClear();
    } finally {
      setClearing(false);
    }
  };

  const rateLimit = status?.rateLimit;

  return (
    <div className="space-y-3 rounded-xl border border-border/80 bg-card/70 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-foreground">GitHub Token</p>
          <p className="text-[11px] text-muted-foreground">
            用于拉取私有仓库与提升速率限制，明文仅传输一次，落库即加密。
          </p>
        </div>
        {status?.hasToken ? (
          <span className="inline-flex items-center rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            已配置
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            未配置
          </span>
        )}
      </div>

      {status?.hasToken && status.maskedToken ? (
        <p className="truncate font-mono text-[12px] text-muted-foreground">{status.maskedToken}</p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="github-token-input">Token</Label>
        <Input
          id="github-token-input"
          type="password"
          autoComplete="off"
          placeholder="ghp_xxx 或 github_pat_xxx"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            if (error) {
              setError(null);
            }
          }}
        />
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy || clearing} onClick={() => void handleSave()}>
          {busy ? '保存中…' : '保存 Token'}
        </Button>
        {status?.hasToken ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || clearing}
            onClick={() => void handleClear()}
          >
            {clearing ? '清除中…' : '清除'}
          </Button>
        ) : null}
        {rateLimit?.remaining != null && rateLimit?.limit != null ? (
          <span className="text-[11px] text-muted-foreground">
            剩余调用 {rateLimit.remaining}/{rateLimit.limit}
          </span>
        ) : null}
      </div>
    </div>
  );
}
