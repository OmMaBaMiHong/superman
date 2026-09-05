/**
 * next/navigation 的 H5 shim：usePathname 跟随 hash 路由，useRouter.push 改 hash。
 */
import { navigateTo, useHashPath } from '../lib/router';

export function usePathname(): string {
  return useHashPath();
}

export function useRouter(): { push: (href: string) => void; replace: (href: string) => void } {
  return {
    push: navigateTo,
    replace: navigateTo,
  };
}

export function useSearchParams(): URLSearchParams {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf('?');
  return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '');
}
