/**
 * Next.js 会话胶水层。令牌与密码的纯逻辑已迁至 src/core/auth/（K2 平移），
 * 本文件只保留依赖 next/headers 的部分：读 cookie、requireApiSession。
 * 为兼容既有调用点，core 的纯函数经这里原样 re-export。
 */
import { cookies } from 'next/headers';
import { fail } from '@/server/infra/http/apiResponse';
import { ServiceUnavailableError, UnauthorizedError } from '@/server/infra/http/errors';
import { getServerEnv } from '@/server/infra/env';
import { getPool } from '@/server/infra/db/pool';
import { getAuthSettings } from '@/server/domains/settings/repositories/settingsRepo';
import { hashPassword, verifyPassword, verifyPlainPassword } from '@/core/auth/password';
import {
  getUserById,
  findUserByUsername,
  persistInitialAdminPassword,
  type UserRow,
} from '@/core/auth/usersRepo';
import {
  AUTH_SESSION_COOKIE_NAME,
  verifySessionToken,
  createSessionToken,
  serializeSessionCookie,
  type ApiSession,
} from '@/core/auth/sessionToken';

export {
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
} from '@/core/auth/sessionToken';
export type { ApiSession } from '@/core/auth/sessionToken';

export type ApiSessionResult =
  | (ApiSession & { response?: never })
  | { response: Response };

const INITIAL_USER_ID = '1';

function shouldBypassSessionGuard(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

async function getInitialUser(): Promise<UserRow | null> {
  return getUserById(getPool(), INITIAL_USER_ID);
}

async function verifyPasswordForUser(
  user: UserRow | null,
  password: string,
): Promise<{
  ok: boolean;
  user?: ApiSession;
  reason?: 'invalid_password' | 'missing_initial_password';
}> {
  if (!user || user.status !== 'active') {
    return { ok: false, reason: 'invalid_password' };
  }

  if (user.passwordHash.trim()) {
    return verifyPassword(password, user.passwordHash)
      ? {
          ok: true,
          user: { userId: user.id, role: user.role, sessionVersion: user.sessionVersion },
        }
      : { ok: false, reason: 'invalid_password' };
  }

  if (user.id !== INITIAL_USER_ID) {
    return { ok: false, reason: 'invalid_password' };
  }

  const envPassword = getServerEnv().AUTH_INITIAL_PASSWORD?.trim();
  if (!envPassword) {
    return { ok: false, reason: 'missing_initial_password' };
  }

  if (!verifyPlainPassword(password, envPassword)) {
    return { ok: false, reason: 'invalid_password' };
  }

  const updated = await persistInitialAdminPassword(getPool(), {
    userId: user.id,
    passwordHash: hashPassword(password),
  });
  const nextUser = updated ?? user;

  return {
    ok: true,
    user: {
      userId: nextUser.id,
      role: nextUser.role,
      sessionVersion: nextUser.sessionVersion,
    },
  };
}

export async function createSessionCookieHeader(input?: {
  userId: string;
  role: import('@/core/auth/usersRepo').UserRole;
  sessionVersion: number;
  secret?: string;
} | string): Promise<string> {
  const legacySecret = typeof input === 'string' ? input : undefined;
  const sessionInput = typeof input === 'object' ? input : undefined;
  const resolvedSecret =
    sessionInput?.secret ??
    legacySecret ??
    (await getAuthSettings(getPool())).authSessionSecret;
  const initialUser = sessionInput ? null : await getInitialUser();
  const session = sessionInput ?? {
    // 兼容旧调用点；后续 route 会改为显式传入当前用户。
    userId: initialUser?.id ?? INITIAL_USER_ID,
    role: initialUser?.role ?? 'admin' as const,
    sessionVersion: initialUser?.sessionVersion ?? 1,
  };

  return serializeSessionCookie(createSessionToken({
    secret: resolvedSecret,
    userId: session.userId,
    role: session.role,
    sessionVersion: session.sessionVersion,
  }));
}

export async function verifyUserPassword(input: {
  username: string;
  password: string;
}): Promise<{
  ok: boolean;
  user?: ApiSession;
  reason?: 'invalid_password' | 'missing_initial_password';
}> {
  return verifyPasswordForUser(
    await findUserByUsername(getPool(), input.username),
    input.password,
  );
}

export async function verifyPasswordAgainstAuthConfig(password: string): Promise<{
  ok: boolean;
  reason?: 'invalid_password' | 'missing_initial_password';
}> {
  const result = await verifyPasswordForUser(await getInitialUser(), password);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export async function isAuthenticated(): Promise<boolean> {
  if (shouldBypassSessionGuard()) {
    return true;
  }

  return (await getApiSession()) !== null;
}

async function getApiSession(): Promise<ApiSession | null> {
  const token = (await cookies()).get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const authSettings = await getAuthSettings(getPool());
  if (!authSettings.authSessionSecret.trim()) {
    return null;
  }

  const payload = verifySessionToken({
    token,
    secret: authSettings.authSessionSecret,
  });

  if (!payload) {
    return null;
  }

  const user = await getUserById(getPool(), payload.userId);
  if (
    !user ||
    user.status !== 'active' ||
    user.role !== payload.role ||
    user.sessionVersion !== payload.sessionVersion
  ) {
    return null;
  }

  return {
    userId: user.id,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}

export async function requireApiSession(): Promise<ApiSessionResult> {
  if (shouldBypassSessionGuard()) {
    return { userId: '1', role: 'admin', sessionVersion: 1 };
  }

  const session = await getApiSession();
  if (session) {
    return session;
  }

  const envPassword = getServerEnv().AUTH_INITIAL_PASSWORD?.trim();
  const initialUser = await getInitialUser();
  if (initialUser && !initialUser.passwordHash.trim() && !envPassword) {
    return { response: fail(new ServiceUnavailableError('未配置初始登录密码，暂时无法提供服务')) };
  }

  return { response: fail(new UnauthorizedError('请先登录后再继续')) };
}
