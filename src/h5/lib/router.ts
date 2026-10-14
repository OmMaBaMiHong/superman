'use client';

import { useSyncExternalStore } from 'react';

/** 当前 hash 路由路径（如 '#/governance' → '/governance'）。 */
export function getHashPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '') return '/';
  return hash.startsWith('/') ? hash : `/${hash}`;
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useHashPath(): string {
  return useSyncExternalStore(subscribeHash, getHashPath, () => '/');
}

export function navigateTo(path: string): void {
  window.location.hash = path.startsWith('/') ? `#${path}` : path;
}

/** Next 路径 → H5 hash 路径；阅读器的设置抽屉链接映射到插件设置页。 */
export function toHashHref(href: string): string {
  const [path, query] = href.split('?');
  if ((path === '' || path === '/') && new URLSearchParams(query).get('settings') === 'open') return '#/settings';
  if (path === '' || path === '/') return '#/discover';
  return `#${path}`;
}
