import { describe, expect, it } from 'vitest';

import { OAuthError } from '@/server/integrations/oauth/oauthErrors';
import {
  collectAllowedHosts,
  getProvider,
  listProviders,
  requireProvider,
} from '@/server/integrations/oauth/oauthProviderRegistry';
import { OAUTH_PROVIDER_IDS } from '@/server/integrations/oauth/oauthProviderTypes';

const REDIRECT_URI = 'https://reader.example.com/api/oauth/callback/github';

/**
 * T02 验收（AQ-3 的验收依据）：
 * 四家适配器在 authorize URL 参数、token 请求方法/参数名、
 * 以及「HTTP 200 也可能是失败」的业务错误判定上，逐项对齐各平台文档。
 */
describe('oauth provider registry', () => {
  it('registers exactly the four declared providers in a stable order', () => {
    expect(listProviders().map((provider) => provider.id)).toEqual([...OAUTH_PROVIDER_IDS]);
  });

  it('resolves providers by id and rejects unknown ids', () => {
    for (const id of OAUTH_PROVIDER_IDS) {
      expect(getProvider(id)?.id).toBe(id);
      expect(requireProvider(id).id).toBe(id);
    }

    expect(getProvider('weibo')).toBeNull();
    expect(getProvider('')).toBeNull();
    expect(getProvider(null)).toBeNull();
    expect(getProvider(123)).toBeNull();
  });

  it('collects every outbound host from the four adapters', () => {
    const hosts = collectAllowedHosts();

    expect(hosts).toContain('github.com');
    expect(hosts).toContain('api.github.com');
    expect(hosts).toContain('api.weixin.qq.com');
    expect(hosts).toContain('open.douyin.com');
    expect(hosts).toContain('open.xiaohongshu.com');

    // 去重且全小写。
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(hosts.every((host) => host === host.toLowerCase())).toBe(true);
  });

  it('keeps every endpoint a hardcoded https constant (ADR-07 / S3)', () => {
    for (const provider of listProviders()) {
      const endpoints = [
        provider.authorizeEndpoint,
        provider.tokenEndpoint,
        provider.refreshEndpoint,
        provider.userInfoEndpoint,
      ].filter((endpoint): endpoint is string => endpoint !== null);

      expect(endpoints.length).toBeGreaterThan(0);
      for (const endpoint of endpoints) {
        expect(endpoint.startsWith('https://')).toBe(true);
      }

      // token / refresh / userinfo 的主机必须都在自己的白名单里。
      const outbound = [
        provider.tokenEndpoint,
        provider.refreshEndpoint,
        provider.userInfoEndpoint,
      ].filter((endpoint): endpoint is string => endpoint !== null);
      for (const endpoint of outbound) {
        expect(provider.allowedHosts).toContain(new URL(endpoint).host);
      }
    }
  });

  it('only advertises PKCE for GitHub (AQ-4)', () => {
    expect(requireProvider('github').capabilities.supportsPkce).toBe(true);
    expect(requireProvider('wechat').capabilities.supportsPkce).toBe(false);
    expect(requireProvider('douyin').capabilities.supportsPkce).toBe(false);
    expect(requireProvider('xiaohongshu').capabilities.supportsPkce).toBe(false);
  });
});

describe('github adapter', () => {
  const github = requireProvider('github');

  it('builds an authorize url with S256 pkce parameters', () => {
    const url = new URL(
      github.buildAuthorizeUrl({
        clientId: 'Iv1.abc',
        redirectUri: REDIRECT_URI,
        state: 'st4te',
        scopes: ['read:user'],
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.abc');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('read:user');
    expect(url.searchParams.get('code_challenge')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('omits pkce params when no challenge is supplied', () => {
    const url = new URL(
      github.buildAuthorizeUrl({
        clientId: 'Iv1.abc',
        redirectUri: REDIRECT_URI,
        state: 'st4te',
        scopes: ['read:user'],
        codeChallenge: null,
      }),
    );

    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('code_challenge_method')).toBe(false);
  });

  it('posts a form-urlencoded token request that asks for JSON', () => {
    const request = github.buildTokenRequest({
      clientId: 'Iv1.abc',
      clientSecret: 's3cr3t',
      code: 'code-1',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'verifier-1',
    });

    expect(request.method).toBe('POST');
    expect(request.bodyKind).toBe('form-urlencoded');
    // 不带 accept: application/json 时 GitHub 会返回 form-urlencoded。
    expect(request.headers.accept).toBe('application/json');
    expect(request.form.client_id).toBe('Iv1.abc');
    expect(request.form.client_secret).toBe('s3cr3t');
    expect(request.form.code).toBe('code-1');
    expect(request.form.redirect_uri).toBe(REDIRECT_URI);
    expect(request.form.code_verifier).toBe('verifier-1');
  });

  it('drops code_verifier when pkce was not used', () => {
    const request = github.buildTokenRequest({
      clientId: 'Iv1.abc',
      clientSecret: 's3cr3t',
      code: 'code-1',
      redirectUri: REDIRECT_URI,
      codeVerifier: null,
    });

    expect(request.form.code_verifier).toBeUndefined();
  });

  it('has no refresh flow (OAuth App tokens do not expire)', () => {
    expect(github.capabilities.supportsRefresh).toBe(false);
    expect(
      github.buildRefreshRequest({
        clientId: 'Iv1.abc',
        clientSecret: 's3cr3t',
        refreshToken: 'rt',
      }),
    ).toBeNull();
  });

  it('parses a successful token response', () => {
    const bundle = github.parseTokenResponse({
      access_token: 'gho_token',
      token_type: 'bearer',
      scope: 'read:user',
    });

    expect(bundle.accessToken).toBe('gho_token');
    expect(bundle.tokenType).toBe('bearer');
    expect(bundle.scope).toBe('read:user');
    expect(bundle.refreshToken).toBeNull();
    expect(bundle.providerAccountId).toBeNull();
  });

  it('throws provider_error on an HTTP 200 error payload', () => {
    expect(() =>
      github.parseTokenResponse({
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      }),
    ).toThrowError(OAuthError);

    try {
      github.parseTokenResponse({ error: 'bad_verification_code' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      expect((err as OAuthError).kind).toBe('provider_error');
    }
  });

  it('throws token_exchange_failed when access_token is missing', () => {
    try {
      github.parseTokenResponse({ token_type: 'bearer' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as OAuthError).kind).toBe('token_exchange_failed');
    }
  });
});

describe('wechat adapter', () => {
  const wechat = requireProvider('wechat');

  it('builds an authorize url with appid and a trailing #wechat_redirect fragment', () => {
    const authorizeUrl = wechat.buildAuthorizeUrl({
      clientId: 'wxappid',
      redirectUri: 'https://reader.example.com/api/oauth/callback/wechat',
      state: 'st4te',
      scopes: ['snsapi_login'],
      codeChallenge: null,
    });

    expect(authorizeUrl.endsWith('#wechat_redirect')).toBe(true);

    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://open.weixin.qq.com/connect/qrconnect');
    // 参数名差异：appid 而非 client_id。
    expect(url.searchParams.get('appid')).toBe('wxappid');
    expect(url.searchParams.has('client_id')).toBe(false);
    expect(url.searchParams.get('scope')).toBe('snsapi_login');
    expect(url.searchParams.get('state')).toBe('st4te');
  });

  it('exchanges the code over GET with appid/secret query params', () => {
    const request = wechat.buildTokenRequest({
      clientId: 'wxappid',
      clientSecret: 'wxsecret',
      code: 'code-1',
      redirectUri: 'https://reader.example.com/api/oauth/callback/wechat',
      codeVerifier: null,
    });

    // 平台怪癖：GET 而非 POST。
    expect(request.method).toBe('GET');
    expect(request.bodyKind).toBe('query');
    expect(request.url).toBe('https://api.weixin.qq.com/sns/oauth2/access_token');
    expect(request.form.appid).toBe('wxappid');
    expect(request.form.secret).toBe('wxsecret');
    expect(request.form.client_id).toBeUndefined();
    expect(request.form.client_secret).toBeUndefined();
    expect(request.form.grant_type).toBe('authorization_code');
  });

  it('builds a GET refresh request', () => {
    const request = wechat.buildRefreshRequest({
      clientId: 'wxappid',
      clientSecret: 'wxsecret',
      refreshToken: 'rt-1',
    });

    expect(request).not.toBeNull();
    expect(request?.method).toBe('GET');
    expect(request?.form.grant_type).toBe('refresh_token');
    expect(request?.form.refresh_token).toBe('rt-1');
    // 刷新接口不需要 secret。
    expect(request?.form.secret).toBeUndefined();
  });

  it('prefers unionid over openid as the account id', () => {
    const bundle = wechat.parseTokenResponse({
      access_token: 'wx_token',
      expires_in: 7200,
      refresh_token: 'wx_refresh',
      openid: 'openid-1',
      unionid: 'unionid-1',
      scope: 'snsapi_login',
    });

    expect(bundle.accessToken).toBe('wx_token');
    expect(bundle.expiresIn).toBe(7200);
    expect(bundle.providerAccountId).toBe('unionid-1');

    const withoutUnionId = wechat.parseTokenResponse({
      access_token: 'wx_token',
      openid: 'openid-1',
    });
    expect(withoutUnionId.providerAccountId).toBe('openid-1');
  });

  it('throws provider_error on HTTP 200 with a non-zero errcode', () => {
    try {
      wechat.parseTokenResponse({ errcode: 40029, errmsg: 'invalid code' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      expect((err as OAuthError).kind).toBe('provider_error');
    }
  });

  it('treats errcode 0 as success', () => {
    const bundle = wechat.parseTokenResponse({
      errcode: 0,
      access_token: 'wx_token',
      openid: 'openid-1',
    });

    expect(bundle.accessToken).toBe('wx_token');
  });
});

describe('douyin adapter', () => {
  const douyin = requireProvider('douyin');

  it('builds an authorize url with client_key', () => {
    const url = new URL(
      douyin.buildAuthorizeUrl({
        clientId: 'awkey',
        redirectUri: 'https://reader.example.com/api/oauth/callback/douyin',
        state: 'st4te',
        scopes: ['user_info'],
        codeChallenge: null,
      }),
    );

    // 参数名差异：client_key 而非 client_id。
    expect(url.searchParams.get('client_key')).toBe('awkey');
    expect(url.searchParams.has('client_id')).toBe(false);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st4te');
  });

  it('posts the token request with client_key', () => {
    const request = douyin.buildTokenRequest({
      clientId: 'awkey',
      clientSecret: 'awsecret',
      code: 'code-1',
      redirectUri: 'https://reader.example.com/api/oauth/callback/douyin',
      codeVerifier: null,
    });

    expect(request.method).toBe('POST');
    expect(request.form.client_key).toBe('awkey');
    expect(request.form.client_secret).toBe('awsecret');
    expect(request.form.client_id).toBeUndefined();
  });

  it('unwraps the nested data node on success', () => {
    const bundle = douyin.parseTokenResponse({
      message: 'success',
      data: {
        error_code: 0,
        access_token: 'dy_token',
        refresh_token: 'dy_refresh',
        expires_in: 1296000,
        refresh_expires_in: 2592000,
        open_id: 'open-1',
        scope: 'user_info',
      },
    });

    expect(bundle.accessToken).toBe('dy_token');
    expect(bundle.refreshToken).toBe('dy_refresh');
    expect(bundle.expiresIn).toBe(1296000);
    expect(bundle.refreshExpiresIn).toBe(2592000);
    expect(bundle.providerAccountId).toBe('open-1');
  });

  it('throws provider_error on HTTP 200 with data.error_code != 0', () => {
    try {
      douyin.parseTokenResponse({
        message: 'error',
        data: { error_code: 2190008, description: 'invalid code' },
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      expect((err as OAuthError).kind).toBe('provider_error');
    }
  });

  it('throws token_exchange_failed when data lacks an access_token', () => {
    try {
      douyin.parseTokenResponse({ data: { error_code: 0, open_id: 'open-1' } });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as OAuthError).kind).toBe('token_exchange_failed');
    }
  });
});

describe('xiaohongshu adapter', () => {
  const xhs = requireProvider('xiaohongshu');

  it('builds a standard OAuth 2.0 authorize url', () => {
    const url = new URL(
      xhs.buildAuthorizeUrl({
        clientId: 'xhs-client',
        redirectUri: 'https://reader.example.com/api/oauth/callback/xiaohongshu',
        state: 'st4te',
        scopes: ['user_info'],
        codeChallenge: null,
      }),
    );

    expect(url.searchParams.get('client_id')).toBe('xhs-client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st4te');
  });

  it('parses a standard token response', () => {
    const bundle = xhs.parseTokenResponse({
      access_token: 'xhs_token',
      refresh_token: 'xhs_refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      open_id: 'open-1',
    });

    expect(bundle.accessToken).toBe('xhs_token');
    expect(bundle.providerAccountId).toBe('open-1');
    expect(bundle.tokenType).toBe('Bearer');
  });

  it('handles both RFC and domestic error shapes', () => {
    for (const payload of [
      { error: 'invalid_grant', error_description: 'code expired' },
      { code: 40001, message: 'invalid code' },
    ]) {
      try {
        xhs.parseTokenResponse(payload);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as OAuthError).kind).toBe('provider_error');
      }
    }

    // code === 0 是成功语义，不能误判。
    expect(xhs.parseTokenResponse({ code: 0, access_token: 'xhs_token' }).accessToken).toBe(
      'xhs_token',
    );
  });
});

describe('cross-provider contract invariants', () => {
  it('never leaks credentials through authorize urls beyond the public client id', () => {
    for (const provider of listProviders()) {
      const authorizeUrl = provider.buildAuthorizeUrl({
        clientId: 'public-client-id',
        redirectUri: REDIRECT_URI,
        state: 'st4te',
        scopes: provider.defaultScopes,
        codeChallenge: provider.capabilities.supportsPkce ? 'challenge' : null,
      });

      expect(authorizeUrl).not.toContain('secret');
      expect(authorizeUrl.startsWith('https://')).toBe(true);
    }
  });

  it('always throws OAuthError (never a bare Error) on malformed payloads', () => {
    for (const provider of listProviders()) {
      for (const payload of [null, undefined, 42, 'nope', {}, []]) {
        expect(() => provider.parseTokenResponse(payload)).toThrowError(OAuthError);
      }
    }
  });

  it('exposes a refresh request exactly when supportsRefresh is true', () => {
    for (const provider of listProviders()) {
      const request = provider.buildRefreshRequest({
        clientId: 'cid',
        clientSecret: 'sec',
        refreshToken: 'rt',
      });

      if (provider.capabilities.supportsRefresh) {
        expect(request, `${provider.id} should support refresh`).not.toBeNull();
        expect(request?.form.refresh_token).toBe('rt');
      } else {
        expect(request, `${provider.id} should not support refresh`).toBeNull();
      }
    }
  });
});
