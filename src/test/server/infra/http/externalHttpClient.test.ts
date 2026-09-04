import { describe, expect, it } from 'vitest';

import { fetchExternalJson } from '@/server/infra/http/externalHttpClient';

/**
 * fetchExternalJson 的 SSRF / 主机白名单行为单测。
 *
 * 关键点：`fetchTextWithValidatedRedirects` 在真正发请求前会先跑 `assertSafeUrl`，
 * 命中拦截时抛 `Error('Unsafe URL')` 且**不会**触达网络层；同时本测试故意不传
 * `logging`，使 `writeExternalRequestLog` 直接早退，避免单测依赖数据库。
 */

const BASE_OPTS = {
  timeoutMs: 1000,
  userAgent: 'FeedFuse-Test/0.4',
} as const;

describe('fetchExternalJson SSRF / allowlist', () => {
  it('blocks off-allowlist hosts even when the base checker would pass', async () => {
    // 模拟「基础 SSRF 校验放行」的极端情况，验证白名单层仍能拦住跨站主机。
    // 绝不允许带着 Authorization 的同一组 headers 被重定向/直连送到白名单外的主机。
    await expect(
      fetchExternalJson('https://evil.example.net/leak-token', {
        ...BASE_OPTS,
        isSafeUrl: async () => true,
        allowedHosts: ['api.github.com'],
      }),
    ).rejects.toThrow('Unsafe URL');
  });

  it('still enforces the base SSRF checker for allowlisted hosts', async () => {
    // 证明白名单不是「绕过基础 SSRF 校验」的后门：host 在白名单内，但基础校验拒绝时也应抛错。
    await expect(
      fetchExternalJson('https://api.github.com/repos/octocat/Hello-World', {
        ...BASE_OPTS,
        isSafeUrl: async () => false,
        allowedHosts: ['api.github.com'],
      }),
    ).rejects.toThrow('Unsafe URL');
  });

  it('rejects an unsafe URL when no allowlist is configured', async () => {
    await expect(
      fetchExternalJson('http://127.0.0.1/internal-metadata', {
        ...BASE_OPTS,
        isSafeUrl: async () => false,
      }),
    ).rejects.toThrow('Unsafe URL');
  });
});
