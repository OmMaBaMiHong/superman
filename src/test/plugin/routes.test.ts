import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler, createStaticHandler } from '@/plugin/host/routes';

interface MockRes {
  status: number | null;
  headers: Record<string, string>;
  body: string;
}

function makeRes(): MockRes & { writeHead(s: number, h?: Record<string, string>): MockRes; end(b?: string): void; setHeader(n: string, v: string): void } {
  const res: MockRes = {
    status: null,
    headers: {},
    body: '',
  };
  return Object.assign(res, {
    writeHead(status: number, headers?: Record<string, string>) {
      res.status = status;
      if (headers) Object.assign(res.headers, headers);
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      if (body) res.body += body;
    },
  });
}

function makeGet(url: string, cookie?: string) {
  return { method: 'GET', url, headers: cookie ? { cookie } : {} } as never;
}

function makePost(url: string, payload: unknown) {
  const req = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> };
  req.method = 'POST';
  req.url = url;
  req.headers = {};
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(payload)));
    req.emit('end');
  });
  return req as never;
}

function makeDeps(db: import('@/plugin/host/db').Queryable | null = null) {
  return {
    auth: createAuth({ username: 'admin', password: 'pw', randomToken: () => 'tok' }),
    db,
    staticRoot: '/nonexistent',
  };
}

describe('plugin/host/routes · /s/api', () => {
  it('GET /s/api/health 返回 { ok: true, name: superman }', async () => {
    const handler = createApiHandler(makeDeps());
    const res = makeRes();
    await handler(makeGet('/s/api/health'), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, name: 'superman', db: false });
  });

  it('POST /s/api/auth/login 成功签发 cookie，错误口令 401', async () => {
    const deps = makeDeps();
    const handler = createApiHandler(deps);
    const bad = makeRes();
    await handler(makePost('/s/api/auth/login', { username: 'admin', password: 'no' }), bad as never);
    expect(bad.status).toBe(401);

    const good = makeRes();
    await handler(makePost('/s/api/auth/login', { username: 'admin', password: 'pw' }), good as never);
    expect(good.status).toBe(200);
    expect(good.headers['set-cookie']).toContain(`${SESSION_COOKIE}=tok`);
  });

  it('GET /s/api/heartbeat 未登录 401，登录后返回最近心跳', async () => {
    const rows = [{ id: 7, plugin: 'superman', created_at: '2026-09-05T00:00:00Z' }];
    const deps = makeDeps({ query: async () => ({ rows }) });
    const handler = createApiHandler(deps);

    const anon = makeRes();
    await handler(makeGet('/s/api/heartbeat'), anon as never);
    expect(anon.status).toBe(401);

    const authed = makeRes();
    await handler(makeGet('/s/api/heartbeat', `${SESSION_COOKIE}=x`), authed as never);
    expect(authed.status).toBe(401); // 未登录过的 token 无效

    deps.auth.login('admin', 'pw');
    const ok = makeRes();
    await handler(makeGet('/s/api/heartbeat', `${SESSION_COOKIE}=tok`), ok as never);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).latest).toMatchObject({ id: 7, plugin: 'superman' });
  });

  it('未知端点 404，非法方法 405', async () => {
    const handler = createApiHandler(makeDeps());
    const res = makeRes();
    await handler(makeGet('/s/api/nope'), res as never);
    expect(res.status).toBe(404);
    const res2 = makeRes();
    await handler(makePost('/s/api/health', {}), res2 as never);
    expect(res2.status).toBe(405);
  });
});

describe('plugin/host/routes · /s/app 静态伺服', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'superman-static-'));
    writeFileSync(join(dir, 'index.html'), '<h1>superman</h1>');
    writeFileSync(join(dir, 'a.js'), 'console.log(1)');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('GET /s/app 回退到 index.html', async () => {
    const handler = createStaticHandler(dir);
    const res = makeRes();
    await handler(makeGet('/s/app'), res as never);
    expect(res.status).toBe(200);
    expect(res.body).toContain('superman');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('命中具体文件并按扩展名给 content-type', async () => {
    const handler = createStaticHandler(dir);
    const res = makeRes();
    await handler(makeGet('/s/app/a.js'), res as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
  });

  it('路径穿越返回 403', async () => {
    const handler = createStaticHandler(dir);
    const res = makeRes();
    await handler(makeGet('/s/app/..%2F..%2Fetc%2Fpasswd'), res as never);
    expect([403, 404]).toContain(res.status);
    if (res.status === 200) throw new Error('路径穿越未被拦截');
  });
});
