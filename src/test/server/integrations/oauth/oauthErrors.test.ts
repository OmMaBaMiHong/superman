import { describe, expect, it } from 'vitest';

import { AppError } from '@/server/infra/http/errors';
import {
  OAuthError,
  getOAuthErrorMessage,
  isOAuthError,
  mapProviderCallbackError,
  normalizeOAuthError,
  toAppError,
  type OAuthErrorKind,
} from '@/server/integrations/oauth/oauthErrors';

const ALL_KINDS: OAuthErrorKind[] = [
  'not_configured',
  'user_denied',
  'invalid_state',
  'state_expired',
  'redirect_uri_mismatch',
  'token_exchange_failed',
  'refresh_failed',
  'provider_error',
  'network',
];

describe('OAuthError', () => {
  it('carries a chinese user-facing message for every kind', () => {
    for (const kind of ALL_KINDS) {
      const error = new OAuthError(kind);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('OAuthError');
      expect(error.kind).toBe(kind);
      expect(error.message.length).toBeGreaterThan(0);
      // 文案必须是中文，且不得直接暴露内部 kind 标识。
      expect(error.message).toMatch(/[\u4e00-\u9fa5]/);
      expect(error.message).not.toContain(kind);
      expect(getOAuthErrorMessage(kind)).toBe(error.message);
    }
  });

  it('keeps debug hints off the user-facing message', () => {
    const error = new OAuthError('provider_error', {
      provider: 'wechat',
      debugHint: 'errcode=40029',
    });

    expect(error.provider).toBe('wechat');
    expect(error.debugHint).toBe('errcode=40029');
    expect(error.message).not.toContain('40029');
  });

  it('defaults optional context to null', () => {
    const error = new OAuthError('network');

    expect(error.debugHint).toBeNull();
    expect(error.provider).toBeNull();
    expect(error.cause).toBeUndefined();
  });

  it('is detectable via isOAuthError', () => {
    expect(isOAuthError(new OAuthError('network'))).toBe(true);
    expect(isOAuthError(new Error('boom'))).toBe(false);
    expect(isOAuthError('network')).toBe(false);
    expect(isOAuthError(null)).toBe(false);
  });
});

describe('toAppError', () => {
  it('maps every kind to a stable code and status', () => {
    const expectations: Record<OAuthErrorKind, { code: string; status: number }> = {
      not_configured: { code: 'oauth_not_configured', status: 400 },
      user_denied: { code: 'oauth_user_denied', status: 400 },
      invalid_state: { code: 'oauth_invalid_state', status: 400 },
      state_expired: { code: 'oauth_state_expired', status: 400 },
      redirect_uri_mismatch: { code: 'oauth_redirect_uri_mismatch', status: 400 },
      token_exchange_failed: { code: 'oauth_token_exchange_failed', status: 502 },
      refresh_failed: { code: 'oauth_refresh_failed', status: 502 },
      provider_error: { code: 'oauth_provider_error', status: 502 },
      network: { code: 'oauth_network_error', status: 503 },
    };

    for (const kind of ALL_KINDS) {
      const appError = toAppError(new OAuthError(kind));

      expect(appError).toBeInstanceOf(AppError);
      expect(appError.code).toBe(expectations[kind].code);
      expect(appError.status).toBe(expectations[kind].status);
      expect(appError.message).toBe(getOAuthErrorMessage(kind));
    }
  });

  it('passes existing AppErrors through untouched', () => {
    const original = new AppError('自定义', 'custom_code', 418);

    expect(toAppError(original)).toBe(original);
  });

  it('degrades unknown throwables to the network error without leaking internals', () => {
    const appError = toAppError(new Error('ECONNREFUSED 10.0.0.1:5432'));

    expect(appError.code).toBe('oauth_network_error');
    expect(appError.status).toBe(503);
    expect(appError.message).not.toContain('10.0.0.1');
    expect(toAppError('boom').code).toBe('oauth_network_error');
    expect(toAppError(null).code).toBe('oauth_network_error');
  });
});

describe('normalizeOAuthError', () => {
  it('returns the original OAuthError untouched', () => {
    const original = new OAuthError('state_expired');

    expect(normalizeOAuthError(original)).toBe(original);
    expect(normalizeOAuthError(original, 'provider_error')).toBe(original);
  });

  it('wraps plain errors with the requested fallback kind', () => {
    const wrapped = normalizeOAuthError(new Error('socket hang up'));

    expect(wrapped).toBeInstanceOf(OAuthError);
    expect(wrapped.kind).toBe('network');
    expect(wrapped.debugHint).toBe('socket hang up');

    expect(normalizeOAuthError(new Error('bad json'), 'provider_error').kind).toBe(
      'provider_error',
    );
  });

  it('stringifies non-error throwables into the debug hint', () => {
    const wrapped = normalizeOAuthError('plain string failure');

    expect(wrapped.kind).toBe('network');
    expect(wrapped.debugHint).toBe('plain string failure');
  });

  it('preserves the original cause for server-side inspection', () => {
    const cause = new Error('root cause');

    expect(normalizeOAuthError(cause).cause).toBe(cause);
  });
});

describe('mapProviderCallbackError', () => {
  it('maps user cancellation variants to user_denied', () => {
    expect(mapProviderCallbackError('access_denied')).toBe('user_denied');
    expect(mapProviderCallbackError('user_denied')).toBe('user_denied');
    expect(mapProviderCallbackError('authorization_declined')).toBe('user_denied');
    // 大小写与空白不敏感。
    expect(mapProviderCallbackError('  ACCESS_DENIED ')).toBe('user_denied');
  });

  it('maps redirect and client configuration failures', () => {
    expect(mapProviderCallbackError('redirect_uri_mismatch')).toBe('redirect_uri_mismatch');
    expect(mapProviderCallbackError('invalid_client')).toBe('not_configured');
    expect(mapProviderCallbackError('unauthorized_client')).toBe('not_configured');
  });

  it('falls back to provider_error for everything else', () => {
    expect(mapProviderCallbackError('server_error')).toBe('provider_error');
    expect(mapProviderCallbackError('temporarily_unavailable')).toBe('provider_error');
    expect(mapProviderCallbackError('some_new_code')).toBe('provider_error');
    expect(mapProviderCallbackError('')).toBe('provider_error');
    expect(mapProviderCallbackError('   ')).toBe('provider_error');
    expect(mapProviderCallbackError(null)).toBe('provider_error');
    expect(mapProviderCallbackError(undefined)).toBe('provider_error');
  });
});
