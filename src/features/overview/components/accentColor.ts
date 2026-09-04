'use client';

import { useEffect, useState } from 'react';

/** canvas 绘制用的 RGB 三元组（0-255）。 */
export type AccentRgb = readonly [number, number, number];

/**
 * 从元素的计算样式里解析某个 CSS 变量的 RGB 三元组。
 *
 * 设计系统铁律：组件内不允许出现颜色字面量，所有配色必须来自 globals.css 的 token。
 * 因此解析失败时返回 `null`（调用方跳过绘制），而不是回退到硬编码颜色。
 */
export function readAccentRgb(element: Element | null, varName: string): AccentRgb | null {
  if (!element || typeof window === 'undefined') return null;

  const raw = window.getComputedStyle(element).getPropertyValue(varName).trim();
  if (!raw) return null;

  const channels = raw.match(/\d+(?:\.\d+)?/g);
  if (!channels || channels.length < 3) return null;

  return [Number(channels[0]), Number(channels[1]), Number(channels[2])];
}

/** 把 token 解析出的 RGB 拼上透明度，供 canvas 的 fillStyle / strokeStyle 使用。 */
export function toCanvasColor(rgb: AccentRgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * 监听 `<html>` 的 class 变化（项目主题由 `.dark` class 驱动，见 `useTheme`）。
 *
 * 返回一个递增的版本号：主题切换时变化，供 canvas 依赖它重新读取 token 并重绘。
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setVersion((current) => current + 1);
    });

    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return version;
}

/** 是否开启了「减少动态效果」。为 true 时 canvas 只绘制一帧静态画面。 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);

    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return reduced;
}

/** 千分位格式化，手写实现避免 `toLocaleString()` 造成 SSR/CSR 文本不一致。 */
export function formatCount(value: number): string {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
  const sign = safe < 0 ? '-' : '';
  return sign + String(Math.abs(safe)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
