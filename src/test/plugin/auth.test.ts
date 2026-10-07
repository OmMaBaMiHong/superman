import { describe, expect, it } from 'vitest';
import { createAuth, parseCookies, readRequestToken, SESSION_COOKIE } from '@/plugin/host/auth';
import { createSessionToken } from '@/core/auth/sessionToken';
import { hashPassword } from '@/core/auth/password';
import { makeHostUsersDb } from './hostUsersDb';

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

describe('plugin/host/auth · Bearer 令牌通道（dsh-app:// 桌面壳）', () => {
  it('readRequestToken 优先取 Authorization: Bearer，其次回退 cookie', () => {
    expect(readRequestToken({ headers: { authorization: 'Bearer abc.def' } } as never)).toBe('abc.def');
    expect(readRequestToken({ headers: { authorization: 'bearer xyz' } } as never)).toBe('xyz');
    expect(readRequestToken({ headers: { cookie: `${SESSION_COOKIE}=from-cookie` } } as never)).toBe('from-cookie');
    // 两者都在时以请求头为准
    expect(
      readRequestToken({ headers: { authorization: 'Bearer from-header', cookie: `${SESSION_COOKIE}=from-cookie` } } as never),
    ).toBe('from-header');
    // 非 Bearer 的 authorization、空头都退回 cookie / 空串
    expect(readRequestToken({ headers: { authorization: 'Basic zzz' } } as never)).toBe('');
    expect(readRequestToken({ headers: {} } as never)).toBe('');
  });

  it('users 表模式：没有 cookie、只带 Authorization 头也能认证（桌面代理会抹掉 cookie）', async () => {
    const auth = createAuth({ db: makeUsersDb([ACTIVE_USER]) as never, secret: 's3cret', now: () => 1_000_000 });
    const session = (await auth.login('admin', 'pw123'))!;
    const res = makeRes();
    const token = auth.issueCookie(res as never, session);

    const viaHeader = await auth.authenticate({ headers: { authorization: `Bearer ${token}` } } as never);
    expect(viaHeader?.userId).toBe('1');
    expect(viaHeader?.username).toBe('admin');

    // 同一枚令牌去掉 Bearer 前缀就无效，避免误认任意头
    expect(await auth.authenticate({ headers: { authorization: token } } as never)).toBeNull();
  });

  it('dev 兜底模式：Authorization 头同样能取到内存会话', async () => {
    process.env.SUPERMAN_DEV_PASSWORD = 'dev-pw';
    try {
      const auth = createAuth({ db: null, secret: '' });
      const session = (await auth.login('admin', 'dev-pw'))!;
      const res = makeRes();
      const token = auth.issueCookie(res as never, session);
      expect(token).toBe(session.token);

      const authed = await auth.authenticate({ headers: { authorization: `Bearer ${token}` } } as never);
      expect(authed?.username).toBe('admin');

      auth.revoke(token);
      expect(await auth.authenticate({ headers: { authorization: `Bearer ${token}` } } as never)).toBeNull();
    } finally {
      delete process.env.SUPERMAN_DEV_PASSWORD;
    }
  });
});

describe('plugin/host/auth · 宿主身份直通（免登录）', () => {
  it('首次宿主身份自动建号（首个绑定= admin）并签发可校验会话', async () => {
    const db = makeHostUsersDb();
    const auth = createAuth({ db: db as never, secret: 's3cret', now: () => 1_000_000 });

    const session = await auth.loginWithHostIdentity({ dshAccountId: 'acc-1', displayName: '李白哥哥' });
    expect(session).not.toBeNull();
    expect(session!.username).toBe('李白哥哥');
    expect(session!.role).toBe('admin');

    // 会话与口令登录同构：HMAC 令牌能过 authenticate（users 表复核）
    const token = auth.mintToken(session!);
    const verified = await auth.authenticate({ headers: { authorization: `Bearer ${token}` } } as never);
    expect(verified?.userId).toBe(session!.userId);
  });

  it('同一宿主身份重复登录复用同一用户；第二个账号建为 member', async () => {
    const db = makeHostUsersDb();
    const auth = createAuth({ db: db as never, secret: 's3cret', now: () => 1_000_000 });

    const first = await auth.loginWithHostIdentity({ dshAccountId: 'acc-1', displayName: '李白哥哥' });
    const again = await auth.loginWithHostIdentity({ dshAccountId: 'acc-1', displayName: '李白哥哥' });
    expect(again!.userId).toBe(first!.userId);
    expect(db.users).toHaveLength(1);

    const second = await auth.loginWithHostIdentity({ dshAccountId: 'acc-2', displayName: '路人' });
    expect(second!.userId).not.toBe(first!.userId);
    expect(second!.role).toBe('member');
  });

  it('无数据库（dev 兜底模式）或空账号 ID 时宿主登录返回 null', async () => {
    const auth = createAuth({ db: null, secret: '' });
    expect(await auth.loginWithHostIdentity({ dshAccountId: 'acc-1', displayName: 'x' })).toBeNull();

    const db = makeHostUsersDb();
    const dbAuth = createAuth({ db: db as never, secret: 's3cret', now: () => 1_000_000 });
    expect(await dbAuth.loginWithHostIdentity({ dshAccountId: '  ', displayName: 'x' })).toBeNull();
  });
});
