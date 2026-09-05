/**
 * 会话令牌纯函数（HMAC 签名 payload）。从 server/domains/auth/services/session.ts
 * 平移到 core：不依赖 next，DSH 插件与 Next.js 版共用同一份令牌格式与校验逻辑。
 * cookie 名、签名算法、exp 语义两边一致，因此 Next.js 签发的 feedfuse_session
 * 在插件侧同样可验（同一 app_settings.auth_session_secret 下）。
 */
import { createHmac } from 'node:crypto';
import { getServerEnv } from '@/server/infra/env';
import { safeEqualText } from '@/core/auth/shared';
import type { UserRole } from '@/core/auth/usersRepo';

export const AUTH_SESSION_COOKIE_NAME = 'feedfuse_session';
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface ApiSession {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export interface SessionPayload extends ApiSession {
  exp: number;
  iat: number;
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(value: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SessionPayload;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.userId !== 'string' ||
      (parsed.role !== 'admin' && parsed.role !== 'member') ||
      typeof parsed.sessionVersion !== 'number'
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function shouldUseSecureSessionCookie(): boolean {
  const secureOverride = getServerEnv().AUTH_COOKIE_SECURE;
  return secureOverride ?? (process.env.NODE_ENV === 'production');
}

export function createSessionToken(input: {
  secret: string;
  userId: string;
  role: UserRole;
  sessionVersion: number;
  nowMs?: number;
  maxAgeSeconds?: number;
}): string {
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeSeconds = input.maxAgeSeconds ?? AUTH_SESSION_MAX_AGE_SECONDS;
  const payload = encodePayload({
    userId: input.userId,
    role: input.role,
    sessionVersion: input.sessionVersion,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + maxAgeSeconds,
  });
  const signature = signPayload(payload, input.secret);
  return `${payload}.${signature}`;
}

export function verifySessionToken(input: {
  token: string;
  secret: string;
  nowMs?: number;
}): SessionPayload | null {
  const [payloadPart, signaturePart] = input.token.split('.');
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = signPayload(payloadPart, input.secret);
  if (!safeEqualText(expectedSignature, signaturePart)) {
    return null;
  }

  const payload = decodePayload(payloadPart);
  if (!payload) {
    return null;
  }

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  return payload.exp > nowSeconds ? payload : null;
}

export function serializeSessionCookie(
  token: string,
  maxAgeSeconds = AUTH_SESSION_MAX_AGE_SECONDS,
): string {
  // 默认生产环境启用 Secure；内网 HTTP 自托管可通过 AUTH_COOKIE_SECURE=false 关闭。
  const secureAttribute = shouldUseSecureSessionCookie() ? '; Secure' : '';
  return `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureAttribute}`;
}

export function serializeExpiredSessionCookie(): string {
  const secureAttribute = shouldUseSecureSessionCookie() ? '; Secure' : '';
  return `${AUTH_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute}`;
}
