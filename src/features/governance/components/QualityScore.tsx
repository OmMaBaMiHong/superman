'use client';

import { cn } from '@/lib/utils';

/** 质量分阈值配色：0-40 灰红 / 40-70 amber / 70+ mint。 */
function scoreClasses(score: number): string {
  if (score >= 70) return 'border-success/40 bg-success/10 text-success';
  if (score >= 40) return 'border-warning/40 bg-warning/10 text-warning';
  return 'border-error/30 bg-error/10 text-error/80';
}

interface QualityScoreProps {
  score: number | null;
}

/** 质量分小号徽章（信息流卡片用；详情页可复用）。 */
export default function QualityScore({ score }: QualityScoreProps) {
  if (score === null) {
    return (
      <span
        aria-label="质量分未知"
        className="inline-flex h-5 items-center rounded-full border border-border px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground"
      >
        —·分
      </span>
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  return (
    <span
      aria-label={`质量分 ${clamped}`}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border px-1.5',
        'font-mono text-[10px] font-semibold tabular-nums',
        scoreClasses(clamped),
      )}
    >
      {clamped}
      <span className="font-normal opacity-70">分</span>
    </span>
  );
}
