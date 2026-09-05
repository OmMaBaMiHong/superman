import { describe, expect, it } from 'vitest';
import { createAuth, parseCookies, SESSION_COOKIE } from '@/plugin/host/auth';

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

describe('plugin/host/auth', () => {
  it('parseCookies 解析分号分隔的 cookie 头', () => {
    expect(parseCookies('a=1; b=2;  c=3')).toEqual({ a: '1', b: '2', c: '3' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('broken; x=y')).toEqual({ x: 'y' });
  });

  it('dev 登录：正确口令签发 session，错误口令拒绝', () => {
    let tick = 1000;
    const auth = createAuth({
      username: 'admin',
      password: 'pw',
      now: () => tick,
      randomToken: () => 'tok-1',
    });
    expect(auth.login('admin', 'wrong')).toBeNull();
    const session = auth.login('admin', 'pw');
    expect(session).not.toBeNull();
    expect(session!.token).toBe('tok-1');
  });

  it('session 可经 cookie 认证，过期后失效', () => {
    let tick = 1000;
    const auth = createAuth({
      username: 'admin',
      password: 'pw',
      sessionTtlMs: 100,
      now: () => tick,
      randomToken: () => 'tok-2',
    });
    auth.login('admin', 'pw');
    expect(auth.authenticate(makeReq(`${SESSION_COOKIE}=tok-2`))?.username).toBe('admin');
    expect(auth.authenticate(makeReq('other=1'))).toBeNull();
    tick += 101;
    expect(auth.authenticate(makeReq(`${SESSION_COOKIE}=tok-2`))).toBeNull();
  });

  it('revoke 后 token 立即失效；issue/clear cookie 写入响应头', () => {
    const auth = createAuth({ username: 'admin', password: 'pw', randomToken: () => 'tok-3' });
    const session = auth.login('admin', 'pw')!;
    const res = makeRes();
    auth.issueCookie(res as never, session);
    expect(res.headers['set-cookie']).toContain(`${SESSION_COOKIE}=tok-3`);
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    auth.revoke('tok-3');
    expect(auth.authenticate(makeReq(`${SESSION_COOKIE}=tok-3`))).toBeNull();
    const res2 = makeRes();
    auth.clearCookie(res2 as never);
    expect(res2.headers['set-cookie']).toContain('Max-Age=0');
  });
});
