'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  formatCount,
  readAccentRgb,
  toCanvasColor,
  usePrefersReducedMotion,
  useThemeVersion,
  type AccentRgb,
} from './accentColor';

const NODE_COUNT = 92;
const COMET_COUNT = 6;
const PERSPECTIVE = 540;
const SPHERE_TILT_X = 0.42;
const ROTATION_STEP = 0.0045;
const MAX_DPR = 2;

/** 斐波那契球面分布的节点。 */
interface SphereNode {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** 沿纬线流动的流光彗星。 */
interface Comet {
  latitude: number;
  angle: number;
  speed: number;
  useUnreadAccent: boolean;
}

export interface ReadingFlowViewProps {
  className?: string;
  /** 参与统计的条目总数。 */
  total?: number;
  /** 其中已消化（已读）的条目数。 */
  processed?: number;
}

/**
 * 中央 3D 阅读流转视图。
 *
 * canvas 绘制斐波那契球面分布的旋转节点云 + 沿纬线流动的流光彗星，
 * 配色来自 `--overview-accent-inbox` / `--overview-accent-unread` 两个 token。
 * 「消化进度」以普通 DOM 文本呈现，保证读屏可访问。
 */
export default function ReadingFlowView({
  className,
  total = 0,
  processed = 0,
}: ReadingFlowViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeVersion = useThemeVersion();
  const reducedMotion = usePrefersReducedMotion();

  const safeTotal = Math.max(0, Math.trunc(total));
  const safeProcessed = Math.min(safeTotal, Math.max(0, Math.trunc(processed)));
  const percent = safeTotal > 0 ? Math.round((safeProcessed / safeTotal) * 100) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const nearAccent: AccentRgb | null = readAccentRgb(canvas, '--overview-accent-inbox');
    const farAccent: AccentRgb | null = readAccentRgb(canvas, '--overview-accent-unread');

    let width = 1;
    let height = 1;
    let angle = 0;
    let frameId = 0;

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const nodes: SphereNode[] = Array.from({ length: NODE_COUNT }, (_, index) => {
      const y = 1 - (index / (NODE_COUNT - 1)) * 2;
      const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = goldenAngle * index;
      return {
        x: Math.cos(theta) * ringRadius,
        y,
        z: Math.sin(theta) * ringRadius,
        radius: 0.5 + Math.random(),
      };
    });

    const comets: Comet[] = Array.from({ length: COMET_COUNT }, (_, index) => ({
      latitude: (Math.random() - 0.5) * 2.4,
      angle: Math.random() * Math.PI * 2,
      speed: 0.01 + Math.random() * 0.022,
      useUnreadAccent: index % 2 === 0,
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = () => {
      const centerX = width / 2;
      const centerY = height / 2;
      const sphereRadius = Math.min(width, height) * 0.37;

      ctx.clearRect(0, 0, width, height);
      if (!nearAccent || !farAccent) return;

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const cosX = Math.cos(SPHERE_TILT_X);
      const sinX = Math.sin(SPHERE_TILT_X);

      const projected = nodes
        .map((node) => {
          const x = node.x * sphereRadius;
          const y = node.y * sphereRadius;
          const z = node.z * sphereRadius;
          const x1 = x * cosA - z * sinA;
          const z1 = x * sinA + z * cosA;
          const y1 = y * cosX - z1 * sinX;
          const z2 = y * sinX + z1 * cosX;
          const scale = PERSPECTIVE / (PERSPECTIVE + z2);
          return {
            screenX: centerX + x1 * scale,
            screenY: centerY + y1 * scale,
            scale,
            depth: z2,
            radius: node.radius,
          };
        })
        .sort((a, b) => a.depth - b.depth);

      for (const point of projected) {
        const alpha = Math.max(0.07, 0.85 - point.depth / (sphereRadius * 2) - 0.28);
        ctx.fillStyle = toCanvasColor(point.depth > 0 ? nearAccent : farAccent, alpha);
        ctx.beginPath();
        ctx.arc(
          point.screenX,
          point.screenY,
          Math.max(0.6, point.radius * point.scale * 1.5),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      for (const comet of comets) {
        const ringRadius = Math.cos(comet.latitude) * sphereRadius;
        const y = Math.sin(comet.latitude) * sphereRadius;
        const x = Math.cos(comet.angle) * ringRadius;
        const z = Math.sin(comet.angle) * ringRadius;
        const x1 = x * cosA - z * sinA;
        const z1 = x * sinA + z * cosA;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const scale = PERSPECTIVE / (PERSPECTIVE + z2);
        const screenX = centerX + x1 * scale;
        const screenY = centerY + y1 * scale;
        const accent = comet.useUnreadAccent ? farAccent : nearAccent;

        ctx.fillStyle = toCanvasColor(accent, 0.95);
        ctx.beginPath();
        ctx.arc(screenX, screenY, 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = toCanvasColor(accent, 0.18);
        ctx.beginPath();
        ctx.arc(screenX, screenY, 6.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) paint();
    });
    observer.observe(canvas);

    resize();

    if (reducedMotion) {
      // 降级：只画一帧静态球体，不启动 rAF。
      paint();
      return () => {
        observer.disconnect();
      };
    }

    const loop = () => {
      angle += ROTATION_STEP;
      for (const comet of comets) {
        comet.angle += comet.speed;
      }
      paint();
      frameId = window.requestAnimationFrame(loop);
    };

    frameId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [reducedMotion, themeVersion]);

  return (
    <section
      className={cn('glass-surface relative overflow-hidden rounded-2xl p-5 sm:p-6', className)}
      aria-label="阅读流转视图"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          阅读流转
        </h3>
        <p className="text-xs text-muted-foreground">知识库消化进度 · 实时流转</p>
      </div>

      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="mt-4 block h-[16rem] w-full sm:h-[21rem]"
      />

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-foreground">
            已消化 <span className="font-mono font-semibold tabular-nums">{percent}%</span>
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{formatCount(safeProcessed)}</span>
            {' / '}
            <span className="font-mono tabular-nums">{formatCount(safeTotal)}</span> 篇
          </p>
        </div>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="知识库消化进度"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </section>
  );
}
