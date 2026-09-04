/**
 * QA 独立边界探查（T05）——oauthHttp 全路径错误归一。
 *
 * 区别于实现者测试（它们多直接调 `parseTokenResponse`），本文件把
 * `requestToken` / `requestOAuthJson` 作为被测对象，mock 最外层
 * `fetchExternalJson`，验证「HTTP 200 也可能是失败」等平台怪癖在
 * **完整出网路径**上依然被归一为正确的 `OAuthError.kind`。
 *
 * 覆盖：
 * 1. 微信 HTTP 200 + errcode=40029 → provider_error（全路径）；
 * 2. 非 2xx 按 purpose 归一：token_exchange / refresh / profile；
 * 3. JSON 解析失败按 purpose 归一；
 * 4. 传输层异常 → OAuthError('network')；
 * 5. 出网选项强制项：maxRedirects:0 + redactResponseBody:true + allowedHosts。
 */

import { describe, expect, it, vi } from 'vitest';

const fetchExternalJsonMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/http/externalHttpClient', () => ({
  fetchExternalJson: (...args: unknown[]) => fetchExternalJsonMock(...args),
}));

import { OAuthError } from '@/server/integrations/oauth/oauthErrors';
import { requestOAuthJson, requestToken } from '@/server/integrations/oauth/oauthHttp';
import { requireProvider } from '@/server/integrations/oauth/oauthProviderRegistry';

function jsonResponse(json: unknown, status = 200): Record<string, unknown> {
  return {
    status,
    finalUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
    contentType: 'application/json',
    headers: {},
    json,
    rawBody: JSON.stringify(json),
    jsonParseError: null,
  };
}

describe('[探针] oauthHttp 全路径错误归一', () => {
  it('微信 HTTP 200 + errcode=40029 走完整 requestToken 路径 → provider_error', async () => {
    fetchExternalJsonMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 40029, errmsg: 'invalid code' }),
    );

    const wechat = requireProvider('wechat');
    const request = wechat.buildTokenRequest({
      clientId: 'wxappid',
      clientSecret: 'wxsecret',
      code: 'bad-code',
      redirectUri: 'https://feedfuse.test/api/oauth/callback/wechat',
      codeVerifier: null,
    });

    await expect(
      requestToken({ provider: wechat, request, purpose: 'token_exchange' }),
    ).rejects.toMatchObject({ kind: 'provider_error' });

    // 出网选项强制项（安全红线 3·7）：POST/GET 一律不跟随重定向 + 响应体脱敏。
    const [, options] = fetchExternalJsonMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options.maxRedirects).toBe(0);
    expect(options.redactResponseBody).toBe(true);
    expect(options.allowedHosts).toEqual(['api.weixin.qq.com']);
    expect(options.method).toBe('GET'); // 微信 token 交换是 GET
  });

  it('非 2xx 按 purpose 归一：token_exchange → token_exchange_failed', async () => {
    fetchExternalJsonMock.mockResolvedValueOnce(jsonResponse({ oops: true }, 401));

    const github = requireProvider('github');
    const request = github.buildTokenRequest({
      clientId: 'Iv1.abc',
      clientSecret: 's3cr3t',
      code: 'code-1',
      redirectUri: 'https://feedfuse.test/api/oauth/callback/github',
      codeVerifier: null,
    });

    const err = await requestToken({ provider: github, request, purpose: 'token_exchange' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).kind).toBe('token_exchange_failed');
    expect((err as OAuthError).debugHint).toBe('HTTP 401');
  });

  it('非 2xx 按 purpose 归一：refresh → refresh_failed', async () => {
    fetchExternalJsonMock.mockResolvedValueOnce(jsonResponse({ oops: true }, 500));

    const wechat = requireProvider('wechat');
    const request = wechat.buildRefreshRequest({
      clientId: 'wxappid',
      clientSecret: 'wxsecret',
      refreshToken: 'rt',
    });

    await expect(
      requestToken({ provider: wechat, request, purpose: 'refresh' }),
    ).rejects.toMatchObject({ kind: 'refresh_failed' });
  });

  it('非 2xx 按 purpose 归一：profile → provider_error', async () => {
    fetchExternalJsonMock.mockResolvedValueOnce(jsonResponse({ oops: true }, 500));

    await expect(
      requestOAuthJson({
        url: 'https://api.github.com/user',
        method: 'GET',
        allowedHosts: ['api.github.com'],
        purpose: 'profile',
        provider: 'github',
      }),
    ).rejects.toMatchObject({ kind: 'provider_error' });
  });

  it('HTTP 200 但 JSON 解析失败 → 按 purpose 归一为失败，而不是返回 null', async () => {
    fetchExternalJsonMock.mockResolvedValueOnce({
      status: 200,
      finalUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
      contentType: 'application/json',
      headers: {},
      json: null,
      rawBody: 'not-json{{',
      jsonParseError: 'Unexpected token',
    });

    const wechat = requireProvider('wechat');
    const request = wechat.buildTokenRequest({
      clientId: 'wxappid',
      clientSecret: 'wxsecret',
      code: 'code-1',
      redirectUri: 'https://feedfuse.test/api/oauth/callback/wechat',
      codeVerifier: null,
    });

    await expect(
      requestToken({ provider: wechat, request, purpose: 'token_exchange' }),
    ).rejects.toMatchObject({ kind: 'token_exchange_failed' });
  });

  it('传输层异常（fetch 拒绝）→ OAuthError(network)，不泄漏内部堆栈', async () => {
    fetchExternalJsonMock.mockRejectedValueOnce(new Error('socket hang up'));

    const github = requireProvider('github');
    const request = github.buildTokenRequest({
      clientId: 'Iv1.abc',
      clientSecret: 's3cr3t',
      code: 'code-1',
      redirectUri: 'https://feedfuse.test/api/oauth/callback/github',
      codeVerifier: null,
    });

    const err = await requestToken({ provider: github, request, purpose: 'token_exchange' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).kind).toBe('network');
  });

  it('SSRF 拦截（Unsafe URL）→ OAuthError(network)', async () => {
    fetchExternalJsonMock.mockRejectedValueOnce(new Error('Unsafe URL'));

    const douyin = requireProvider('douyin');
    const request = douyin.buildTokenRequest({
      clientId: 'awkey',
      clientSecret: 'awsecret',
      code: 'code-1',
      redirectUri: 'https://feedfuse.test/api/oauth/callback/douyin',
      codeVerifier: null,
    });

    await expect(
      requestToken({ provider: douyin, request, purpose: 'token_exchange' }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});
