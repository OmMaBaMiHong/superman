import { beforeEach, describe, expect, it } from 'vitest';
import { getHashPath, toHashHref } from '../../h5/lib/router';
import { configureApiClientPaths, getGovernanceStats } from '@/lib/api/apiClient';

describe('h5 hash 路由工具', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('hash → 路径解析', () => {
    window.location.hash = '#/governance';
    expect(getHashPath()).toBe('/governance');
    window.location.hash = '#/studio';
    expect(getHashPath()).toBe('/studio');
    window.location.hash = '';
    expect(getHashPath()).toBe('/');
  });

  it('Next 路径 → hash href（/ 映射到阅读器，query 丢弃）', () => {
    expect(toHashHref('/')).toBe('#/reader');
    expect(toHashHref('/governance')).toBe('#/governance');
    expect(toHashHref('/trending')).toBe('#/trending');
    expect(toHashHref('/studio')).toBe('#/studio');
    expect(toHashHref('/?settings=open')).toBe('#/reader');
  });
});

describe('apiClient 宿主前缀配置（K3 适配层）', () => {
  it('配置 /s 前缀后请求指向 /s/api/*，恢复后回到 /api/*', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(input instanceof Request ? input.url : String(input));
      return new Response(JSON.stringify({ ok: false, error: { code: 'x', message: 'y' } }), { status: 400 });
    }) as typeof fetch;

    try {
      configureApiClientPaths({ apiPrefix: '/s', loginPath: '/s/app/#/login' });
      await getGovernanceStats({ notifyOnError: false, redirectOnUnauthorized: false }).catch(() => {});
      expect(seen[0]).toContain('/s/api/governance/stats');

      configureApiClientPaths({ apiPrefix: '', loginPath: '/login' });
      await getGovernanceStats({ notifyOnError: false, redirectOnUnauthorized: false }).catch(() => {});
      expect(seen[1]).toContain('/api/governance/stats');
      expect(seen[1]).not.toContain('/s/api');
    } finally {
      globalThis.fetch = originalFetch;
      configureApiClientPaths({ apiPrefix: '', loginPath: '/login' });
    }
  });
});
