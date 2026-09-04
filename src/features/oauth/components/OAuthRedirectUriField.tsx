'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface OAuthRedirectUriFieldProps {
  /** 服务端推导的回调地址，前端**只读**，不可编辑。 */
  redirectUri: string;
  /** 微信等要求逐字节匹配的平台会加强提示语。 */
  requiresExactMatch: boolean;
  inputId: string;
}

const COPIED_FEEDBACK_MS = 1600;

/**
 * 回调地址只读展示 + 一键复制。
 *
 * 为什么只读：`redirect_uri` 由服务端单向推导（ADR-05），允许前端改动等于开放重定向。
 * 用户唯一要做的就是把它原样粘贴到平台后台，所以复制按钮是这里的主操作。
 */
export default function OAuthRedirectUriField({
  redirectUri,
  requiresExactMatch,
  inputId,
}: OAuthRedirectUriFieldProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const markCopied = useCallback(() => {
    setCopied(true);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(redirectUri);
        markCopied();
        return;
      }
    } catch {
      // Clipboard API 在非安全上下文（http 局域网访问）会被拒绝，落到下面的兜底。
    }

    // 兜底：选中输入框内容，用户按 Ctrl/Cmd+C 即可。
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, [redirectUri, inputId, markCopied]);

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>回调地址（Redirect URI）</Label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="text"
          readOnly
          value={redirectUri}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2 font-mono text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          size="compact"
          variant="outline"
          className="shrink-0 gap-1"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {requiresExactMatch
          ? '请将该地址原样填入平台后台，该平台要求逐字节完全一致，多一个斜杠都会授权失败。'
          : '请将该地址原样填入平台后台的回调地址配置项。'}
      </p>
    </div>
  );
}
