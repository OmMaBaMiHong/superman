'use client';

import { useMemo } from 'react';

interface SparklineProps {
  /** 时间正序的数值序列（null 视为断点，按 0 处理但不出点）。 */
  series: Array<{ label: string; color: string; values: Array<number | null> }>;
  height?: number;
}

/**
 * 纯 SVG 迷你折线（sparkline，零依赖）：7 天数据曲线。
 * 多序列共用坐标系；null 点跳过；首末点带端点圆点。
 */
export default function Sparkline({ series, height = 72 }: SparklineProps) {
  const { paths, max } = useMemo(() => {
    const allValues = series.flatMap((entry) => entry.values.filter((v): v is number => v !== null));
    const maxValue = Math.max(1, ...allValues);
    const result = series.map((entry) => {
      const visible = entry.values.filter((v): v is number => v !== null);
      const step = visible.length > 1 ? 100 / (visible.length - 1) : 0;
      const points = visible.map((value, index) => ({
        x: visible.length > 1 ? index * step : 50,
        y: 100 - (value / maxValue) * 90 - 5,
        value,
      }));
      const d = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ');
      return { label: entry.label, color: entry.color, d, points };
    });
    return { paths: result, max: maxValue };
  }, [series]);

  if (paths.every((entry) => entry.points.length === 0)) {
    return <p className="py-4 text-center text-[11px] text-muted-foreground">还没有快照数据</p>;
  }

  return (
    <div data-testid="sparkline">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="7 天数据曲线"
      >
        {paths.map((entry) => (
          <g key={entry.label}>
            <path
              d={entry.d}
              fill="none"
              stroke={entry.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {entry.points.map((point, index) => (
              <circle key={index} cx={point.x} cy={point.y} r="1.6" fill={entry.color} />
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex items-center gap-3">
        {paths.map((entry) => (
          <span key={entry.label} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/70">
          峰值 {max.toLocaleString('zh-CN')}
        </span>
      </div>
    </div>
  );
}
