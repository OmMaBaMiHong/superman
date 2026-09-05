'use client';

import { cn } from '@/lib/utils';

/** 质量分分段阈值：0-40 灰红 / 40-70 amber / 70+ mint。 */
function scoreColorClass(score: number): { text: string; bar: string } {
  if (score >= 70) return { text: 'text-success', bar: 'bg-success' };
  if (score >= 40) return { text: 'text-warning', bar: 'bg-warning' };
  return { text: 'text-error/70', bar: 'bg-error/60' };
}

const SEGMENT_COUNT = 5;

interface QualityScoreProps {
  score: number | null;
}

/** 质量分：大号 JetBrains Mono 数字 + 分段条形指示。 */
export default function QualityScore({ score }: QualityScoreProps) {
  if (score === null) {
    return (
      <div className="flex flex-col items-end gap-1" aria-label="质量分未知">
        <span className="font-mono text-2xl font-light text-muted-foreground">—</span>
        <span className="gov-label">Score</span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const filledSegments = Math.round((clamped / 100) * SEGMENT_COUNT);
  const color = scoreColorClass(clamped);

  return (
    <div className="flex flex-col items-end gap-1" aria-label={`质量分 ${clamped}`}>
      <span className={cn('font-mono text-2xl font-semibold tabular-nums', color.text)}>
        {clamped}
      </span>
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1 w-3 rounded-[1px]',
              index < filledSegments ? color.bar : 'bg-border',
            )}
          />
        ))}
      </div>
      <span className="gov-label">Score</span>
    </div>
  );
}
