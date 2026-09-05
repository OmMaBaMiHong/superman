'use client';

import { useState } from 'react';
import { PenLine } from 'lucide-react';
import type { RewritePlatform } from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { cn } from '@/lib/utils';
import { PLATFORM_META, REWRITE_PLATFORM_IDS } from '../lib/platforms';

interface PlatformPickerSheetProps {
  open: boolean;
  articleTitle: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (platforms: RewritePlatform[]) => void;
}

/** 平台多选 sheet：公众号深度文 / 小红书种草 / 小说化改写，各带说明与预计字数。 */
export default function PlatformPickerSheet({
  open,
  articleTitle,
  submitting,
  onClose,
  onConfirm,
}: PlatformPickerSheetProps) {
  const [selected, setSelected] = useState<Set<RewritePlatform>>(new Set(['wechat']));

  const toggle = (platform: RewritePlatform) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  return (
    <GlassDetailSheet open={open} onClose={onClose} ariaLabel={`选择改写平台：${articleTitle}`}>
      <div className="px-5 pb-6 pt-1 sm:px-7">
        <div className="flex items-center gap-2">
          <PenLine aria-hidden="true" className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">生成稿件</h2>
        </div>
        <p className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">{articleTitle}</p>

        <div className="mt-4 space-y-2">
          {REWRITE_PLATFORM_IDS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const checked = selected.has(platform);
            return (
              <button
                key={platform}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(platform)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  checked
                    ? 'border-primary/50 bg-primary/[0.08]'
                    : 'border-border hover:bg-accent/60',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                    checked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{meta.name}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {meta.estimate}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                    {meta.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            取消
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || submitting}
            onClick={() => onConfirm(Array.from(selected))}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5',
              'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {submitting ? '提交中…' : `开始生成（${selected.size}）`}
          </button>
        </div>
      </div>
    </GlassDetailSheet>
  );
}
