'use client';

import { RotateCcw } from 'lucide-react';
import type { PipelineJobItem, PipelineJobStatus } from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import { platformName } from '../lib/platforms';

const STATUS_META: Record<PipelineJobStatus, { label: string; dotClass: string; textClass: string; pulse: boolean }> = {
  running: { label: '运行中', dotClass: 'bg-primary', textClass: 'text-primary', pulse: true },
  queued: { label: '排队中', dotClass: 'bg-warning', textClass: 'text-warning', pulse: false },
  succeeded: { label: '已完成', dotClass: 'bg-success', textClass: 'text-success', pulse: false },
  failed: { label: '失败', dotClass: 'bg-error', textClass: 'text-error', pulse: false },
};

function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** LLM 未配置的引导：错误信息命中关键词时给出设置页指引。 */
function isAiNotConfigured(error: string | null): boolean {
  if (!error) return false;
  return /未配置|api[\s_-]?key|missing|configure/i.test(error);
}

interface PipelineJobListProps {
  jobs: PipelineJobItem[];
  retrying: Record<string, boolean>;
  onRetry: (job: PipelineJobItem) => void;
}

/** 流水线任务列表：running 脉冲绿 / queued 琥珀 / failed 红（错误详情 + 重试）/ succeeded mint。 */
export default function PipelineJobList({ jobs, retrying, onRetry }: PipelineJobListProps) {
  return (
    <ul className="space-y-2.5">
      {jobs.map((job) => {
        const meta = STATUS_META[job.status] ?? STATUS_META.queued;
        return (
          <li
            key={job.id}
            data-testid="pipeline-job"
            data-status={job.status}
            className="gov-card p-4 [--gov-accent:var(--glass-border)]"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClass, meta.pulse && 'gov-pulse-dot')}
              />
              <span className={cn('text-[11px] font-medium', meta.textClass)}>{meta.label}</span>
              <span className="rounded-full border border-border bg-secondary px-1.5 py-px text-[10px] text-secondary-foreground">
                {platformName(job.platform)}
              </span>
              <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatDuration(job.durationMs)}
              </span>
            </div>

            <p className="mt-2 line-clamp-1 text-sm font-medium text-foreground">
              {job.articleTitle}
            </p>

            {job.status === 'failed' ? (
              <div className="mt-2 rounded-xl border border-error/30 bg-error/[0.06] px-3 py-2">
                <p className="break-all font-mono text-[11px] leading-relaxed text-error/90">
                  {job.error ?? '未知错误'}
                </p>
                {isAiNotConfigured(job.error) ? (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    看起来还没有配置 AI 服务。
                    <a
                      href="/?settings=open"
                      className="ml-1 text-primary transition-colors duration-150 hover:opacity-80"
                    >
                      去设置页配置 →
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="font-mono tabular-nums">
                {new Date(job.createdAt).toLocaleString('zh-CN', { hour12: false })}
              </span>
              {job.status === 'failed' ? (
                <button
                  type="button"
                  disabled={retrying[job.id]}
                  onClick={() => onRetry(job)}
                  className={cn(
                    'inline-flex h-11 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-4 sm:h-8',
                    'text-xs font-medium text-warning transition-all duration-150 hover:bg-warning/20 active:scale-[0.97]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                  {retrying[job.id] ? '重试中…' : '重试'}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
