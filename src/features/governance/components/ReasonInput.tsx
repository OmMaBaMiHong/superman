'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ReasonInputProps {
  open: boolean;
  kind: 'reject' | 'redraft';
  submitting: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}

const COPY = {
  reject: {
    placeholder: '驳回理由（会写入驳回记忆）… Enter 提交，Esc 取消',
    submit: '确认驳回',
  },
  redraft: {
    placeholder: '重拟意见，例如「标题太平，重来」… Enter 提交，Esc 取消',
    submit: '打回重拟',
  },
} as const;

/** 卡片内联理由输入框（不弹 modal）：Enter 提交，Esc 取消；折叠展开 0.42s。 */
export default function ReasonInput({
  open,
  kind,
  submitting,
  onSubmit,
  onCancel,
}: ReasonInputProps) {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // 等展开动画起步后再聚焦/清空，避免布局抖动。
      const timer = window.setTimeout(() => {
        setReason('');
        inputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  const submit = () => {
    if (submitting) return;
    onSubmit(reason.trim());
  };

  return (
    <div className={cn('gov-collapse', open && 'gov-collapse-open')} aria-hidden={!open}>
      <div>
        <div className="flex items-center gap-2 pt-3">
          <input
            ref={inputRef}
            type="text"
            value={reason}
            disabled={!open || submitting}
            placeholder={COPY[kind].placeholder}
            aria-label={kind === 'reject' ? '驳回理由' : '重拟意见'}
            tabIndex={open ? 0 : -1}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
            className={cn(
              'h-11 flex-1 rounded-md border bg-background px-3 font-mono text-xs text-foreground sm:h-8',
              'placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1',
              kind === 'reject'
                ? 'border-error/40 focus-visible:ring-error'
                : 'border-warning/40 focus-visible:ring-warning',
            )}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!open || submitting}
            onClick={submit}
            className={cn(
              'h-11 font-mono text-xs sm:h-8',
              kind === 'reject'
                ? 'text-error hover:bg-error/10 hover:text-error'
                : 'text-warning hover:bg-warning/10 hover:text-warning',
            )}
          >
            {submitting ? '呈递中…' : COPY[kind].submit}
          </Button>
        </div>
      </div>
    </div>
  );
}
