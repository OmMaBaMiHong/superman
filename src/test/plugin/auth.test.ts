import { describe, expect, it } from 'vitest';
import { createAuth, parseCookies, SESSION_COOKIE } from '@/plugin/host/auth';
import { createSessionToken } from '@/core/auth/sessionToken';
import { hashPassword } from '@/core/auth/password';

function makeReq(cookie?: string) {
  return { headers: cookie ? { cookie } : {} };
}

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  };
}

/** 内存 users 表假库：按 SQL 关键字路由到用户查询。 */
function makeUsersDb(users: Record<string, unknown>[]) {
  return {
    async query(text: string, params?: readonly unknown[]) {
      if (text.includes('from users') && text.includes('lower(username)')) {
        const hit = users.find((u) => String(u.username).toLowerCase() === String(params?.[0]).toLowerCase());
        return { rows: hit ? [hit] : [] };
      }
      if (text.includes('from users') && text.includes('where id =')) {
        const hit = users.find((u) => String(u.id) === String(params?.[0]));
        return { rows: hit ? [hit] : [] };
      }
      if (text.includes('update users')) return { rows: [users.find((u) => String(u.id) === String(params?.[0]))] };
      return { rows: [] };
    },
  };
}

const ACTIVE_USER = {
  id: '1',
  username: 'admin',
  passwordHash: hashPassword('pw123'),
  role: 'admin' as const,
  status: 'active' as const,
  sessionVersion: 3,
  type: 'initial_admin' as const,
  createdAt: '',
  updatedAt: '',
};

describe('plugin/host/auth · cookie 解析', () => {
  it('parseCookies 解析分号分隔的 cookie 头', () => {
    expect(parseCookies('a=1; b=2;  c=3')).toEqual({ a: '1', b: '2', c: '3' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('broken; x=y')).toEqual({ x: 'y' });
  });
});

describe('plugin/host/auth · users 表模式', () => {
  it('正确口令登录成功并签发 HMAC 会话 cookie，错误口令拒绝', async () => {
    const auth = createAuth({ db: makeUsersDb([ACTIVE_USER]) as never, secret: 's3cret', now: () => 1_000_000 });
    expect(await auth.login('admin', 'wrong')).toBeNull();
    const session = await auth.login('admin', 'pw123');
    expect(session?.userId).toBe('1');

    const res = makeRes();
    auth.issueCookie(res as never, session!);
    const cookie = res.headers['set-cookie'];
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');

    const token = /superman_session=([^;]+)/.exec(cookie)![1]!;
    const authed = await auth.authenticate(makeReq(`${SESSION_COOKIE}=${token}`));
    expect(authed?.userId).toBe('1');
    expect(authed?.role).toBe('admin');
  });

  it('禁用用户与 sessionVersion 漂移的令牌被拒绝', async () => {
    const users = [ACTIVE_USER];
    const auth = createAuth({ db: makeUsersDb(users) as never, secret: 's3cret' });
    const session = (await auth.login('admin', 'pw123'))!;
    const res = makeRes();
    auth.issueCookie(res as never, session);
    const token = /superman_session=([^;]+)/.exec(res.headers['set-cookie'])![1]!;

    users[0] = { ...ACTIVE_USER, sessionVersion: 4 }; // 密码重置后旧令牌失效
    expect(await auth.authenticate(makeReq(`${SESSION_COOKIE}=${token}`))).toBeNull();
  });

  it('伪造签名 / 过期令牌被拒绝', async () => {
    const auth = createAuth({ db: makeUsersDb([ACTIVE_USER]) as never, secret: 's3cret' });
    const forged = createSessionToken({ secret: 'other', userId: '1', role: 'admin', sessionVersion: 3 });
    expect(await auth.authenticate(makeReq(`${SESSION_COOKIE}=${encodeURIComponent(forged)}`))).toBeNull();
    const expired = createSessionToken({ secret: 's3cret', userId: '1', role: 'admin', sessionVersion: 3, nowMs: 1_000, maxAgeSeconds: 1 });
    expect(await auth.authenticate(makeReq(`${SESSION_COOKIE}=${encodeURIComponent(expired)}`))).toBeNull();
  });
});

describe('plugin/host/auth · dev 兜底模式（无数据库）', () => {
  it('硬编码 dev 登录 + 内存 session + revoke', async () => {
    process.env.SUPERMAN_DEV_PASSWORD = 'dev-pw';
    try {
      const auth = createAuth({ db: null, secret: '' });
      expect(await auth.login('admin', 'bad')).toBeNull();
      const session = await auth.login('admin', 'dev-pw');
      expect(session?.userId).toBe('1');

      const res = makeRes();
      auth.issueCookie(res as never, session!);
      const token = /superman_session=([^;]+)/.exec(res.headers['set-cookie'])![1]!;
      expect((await auth.authenticate(makeReq(`${SESSION_COOKIE}=${token}`)))?.username).toBe('admin');

      auth.revoke(session!.token!);
      expect(await auth.authenticate(makeReq(`${SESSION_COOKIE}=${token}`))).toBeNull();

      const res2 = makeRes();
      auth.clearCookie(res2 as never);
      expect(res2.headers['set-cookie']).toContain('Max-Age=0');
    } finally {
      delete process.env.SUPERMAN_DEV_PASSWORD;
    }
  });
});
