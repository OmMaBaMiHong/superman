'use client';

import type { LucideIcon } from 'lucide-react';
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

/** 粒子数上限：性能优先，实际按卡片面积自适应后再取 min。 */
const MAX_PARTICLES = 60;
const MIN_PARTICLES = 16;
const AREA_PER_PARTICLE = 6200;
/** 近邻连线的距离平方阈值。 */
const LINK_DISTANCE_SQUARED = 2700;
/** 光标斥力半径（CSS px）。 */
const REPEL_RADIUS = 78;
/** 3D 倾斜幅度上限（deg），克制处理。 */
const MAX_TILT_DEG = 6;
/** 倾斜复位的指数缓出系数（不回弹）。 */
const TILT_EASING = 0.12;
const MAX_DPR = 2;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ParticleStatCardProps {
  /** 指标名称，如「今日新增」。 */
  label: string;
  /** 指标数值，渲染为 DOM 文本（不只画在 canvas 上）。 */
  value: number;
  /** 辅助说明，如「较昨日 +12」。 */
  hint?: string;
  /** 分区色 CSS 变量名，如 `--overview-accent-inbox`。 */
  accentVar: string;
  icon: LucideIcon;
  className?: string;
}

/**
 * 流体扰动粒子统计卡片。
 *
 * canvas 粒子层在内容层下方（`aria-hidden`），中间垫一层 token 化遮罩
 * （`--overview-scrim`）保证文字始终以 `text-foreground` / `text-muted-foreground`
 * 语义色达到 WCAG AA 对比度，不被粒子干扰。
 */
export default function ParticleStatCard({
  label,
  value,
  hint,
  accentVar,
  icon: Icon,
  className,
}: ParticleStatCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeVersion = useThemeVersion();
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const card = cardRef.current;
    const canvas = canvasRef.current;
    if (!card || !canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // 主题切换时 themeVersion 变化 -> effect 重跑 -> 重新读取分区色 token。
    const accent: AccentRgb | null = readAccentRgb(card, accentVar);

    let width = 1;
    let height = 1;
    let particles: Particle[] = [];
    let frameId = 0;

    const pointer = { x: -9999, y: -9999, inside: false };
    const tilt = { x: 0, y: 0, targetX: 0, targetY: 0 };

    const seedParticles = () => {
      const byArea = Math.round((width * height) / AREA_PER_PARTICLE);
      const count = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, byArea));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, rect.width);
      const nextHeight = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      width = nextWidth;
      height = nextHeight;
      canvas.width = Math.round(nextWidth * dpr);
      canvas.height = Math.round(nextHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles();
    };

    const advance = () => {
      const speed = pointer.inside ? 1.9 : 1;

      for (const particle of particles) {
        particle.x += particle.vx * speed;
        particle.y += particle.vy * speed;

        if (pointer.inside) {
          const dx = particle.x - pointer.x;
          const dy = particle.y - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < REPEL_RADIUS && distance > 0.01) {
            const force = (1 - distance / REPEL_RADIUS) * 1.5;
            particle.x += (dx / distance) * force;
            particle.y += (dy / distance) * force;
          }
        }

        if (particle.x < 0) particle.x += width;
        if (particle.x > width) particle.x -= width;
        if (particle.y < 0) particle.y += height;
        if (particle.y > height) particle.y -= height;
      }
    };

    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      if (!accent) return;

      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const squared = dx * dx + dy * dy;
          if (squared >= LINK_DISTANCE_SQUARED) continue;

          ctx.strokeStyle = toCanvasColor(
            accent,
            (1 - squared / LINK_DISTANCE_SQUARED) * 0.18,
          );
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      ctx.fillStyle = toCanvasColor(accent, pointer.inside ? 0.9 : 0.55);
      for (const particle of particles) {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const applyTilt = () => {
      tilt.x += (tilt.targetX - tilt.x) * TILT_EASING;
      tilt.y += (tilt.targetY - tilt.y) * TILT_EASING;
      const settled = Math.abs(tilt.x) < 0.01 && Math.abs(tilt.y) < 0.01;
      card.style.transform = settled
        ? ''
        : `rotateX(${tilt.x.toFixed(3)}deg) rotateY(${tilt.y.toFixed(3)}deg)`;
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) paint();
    });
    observer.observe(canvas);

    resize();

    if (reducedMotion) {
      // 降级：只绘制一帧静态粒子，不启动 rAF，不做 3D 倾斜。
      paint();
      return () => {
        observer.disconnect();
      };
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const ratioX = (event.clientX - rect.left) / rect.width;
      const ratioY = (event.clientY - rect.top) / rect.height;
      const canvasRect = canvas.getBoundingClientRect();

      pointer.x = event.clientX - canvasRect.left;
      pointer.y = event.clientY - canvasRect.top;
      pointer.inside = true;

      tilt.targetX = (0.5 - ratioY) * MAX_TILT_DEG * 2;
      tilt.targetY = (ratioX - 0.5) * MAX_TILT_DEG * 2;
      card.style.setProperty('--overview-glare-x', `${(ratioX * 100).toFixed(2)}%`);
      card.style.setProperty('--overview-glare-y', `${(ratioY * 100).toFixed(2)}%`);
    };

    const handlePointerLeave = () => {
      pointer.inside = false;
      pointer.x = -9999;
      pointer.y = -9999;
      tilt.targetX = 0;
      tilt.targetY = 0;
    };

    const loop = () => {
      advance();
      paint();
      applyTilt();
      frameId = window.requestAnimationFrame(loop);
    };

    card.addEventListener('pointermove', handlePointerMove);
    card.addEventListener('pointerleave', handlePointerLeave);
    card.addEventListener('pointercancel', handlePointerLeave);
    frameId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      card.removeEventListener('pointermove', handlePointerMove);
      card.removeEventListener('pointerleave', handlePointerLeave);
      card.removeEventListener('pointercancel', handlePointerLeave);
      card.style.transform = '';
      card.style.removeProperty('--overview-glare-x');
      card.style.removeProperty('--overview-glare-y');
    };
  }, [accentVar, reducedMotion, themeVersion]);

  return (
    <div
      ref={cardRef}
      className={cn(
        'group glass-surface relative min-h-[10.5rem] overflow-hidden rounded-2xl p-5',
        'transition-shadow duration-300 hover:shadow-[var(--shadow-glass-hover)]',
        'motion-reduce:transition-none',
        className,
      )}
      style={{ willChange: 'transform' }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 block h-full w-full"
      />
      {/* 极淡 token 化遮罩：压住粒子层，保证正文对比度达 WCAG AA。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'var(--overview-scrim)' }}
      />
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300',
          'group-hover:opacity-100 motion-reduce:transition-none',
        )}
        style={{
          background:
            'radial-gradient(circle at var(--overview-glare-x, 50%) var(--overview-glare-y, 50%), var(--overview-glare), transparent 46%)',
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatCount(value)}
          </p>
          {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            color: `var(${accentVar})`,
            backgroundColor: `color-mix(in oklab, var(${accentVar}) 14%, transparent)`,
          }}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
