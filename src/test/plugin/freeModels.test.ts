import { Readable } from 'node:stream';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

describe.skipIf(!process.env.TEST_DATABASE_URL)('free model settings · PostgreSQL', () => {
  let pool: Pool;
  let db: PoolClient;
  let handler: ReturnType<typeof createApiHandler>;
  let cookie: string;
  const catalog = { data: [
    { id: 'openrouter/free', name: 'Free Router', pricing: { prompt: '0', completion: '0' } },
    { id: 'a/good:free', name: 'Good', pricing: { prompt: '0.000', completion: '0', request: '0' } },
    { id: 'a/paid', pricing: { prompt: '1', completion: '1' } },
    { id: 'a/misleading:free', pricing: { prompt: '0', completion: '1' } },
    { id: 'a/request:free', pricing: { prompt: '0', completion: '0', request: '1' } },
    { id: 'a/unknown:free' },
  ] };
  async function request(path: string, method = 'GET', payload = {}, authenticated = true) {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), {
      method, url: `/s/api${path}`, headers: authenticated ? { cookie } : {},
    });
    let status = 0;
    let body = '';
    await handler(req as never, { writeHead(value: number) { status = value; }, end(value?: string) { body += value ?? ''; } } as never);
    return { status, ...JSON.parse(body) };
  }
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    db = await pool.connect();
    await db.query('begin');
    await db.query('create temporary table user_settings (user_id bigint primary key, ui_settings jsonb default \'{}\', ai_api_key text, updated_at timestamptz)');
    const auth = createAuth({ db: null, secret: '' });
    const session = (await auth.login('admin', 'superman-dev'))!;
    auth.issueCookie({ setHeader(_key: string, value: string) { cookie = `${SESSION_COOKIE}=${/superman_session=([^;]+)/.exec(value)![1]}`; } } as never, session);
    handler = createApiHandler({ auth, db, staticRoot: '/nonexistent' });
  });
  beforeEach(async () => {
    await db.query(`truncate pg_temp.user_settings;
      insert into user_settings(user_id,ui_settings,ai_api_key) values
        (1,'{"general":{"theme":"dark"},"ai":{"model":"existing","apiBaseUrl":"https://existing.example/v1"}}','private-one'),
        (2,'{"ai":{"model":"other"}}','private-two')`);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(catalog)));
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { await db?.query('rollback'); db?.release(); await pool?.end(); });

  it('requires login and never exposes the saved key', async () => {
    expect((await request('/ai/settings', 'GET', {}, false)).status).toBe(401);
    const response = await request('/ai/settings');
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ providerMode: 'configured', freeModel: 'openrouter/free' });
    expect(JSON.stringify(response)).not.toContain('private-one');
  });
  it('lists only explicitly free IDs with zero known pricing', async () => {
    const response = await request('/ai/free-models');
    expect(response.status).toBe(200);
    expect(response.data.items.map((m: { id: string }) => m.id)).toEqual(['openrouter/free', 'a/good:free']);
  });
  it('changes only the signed-in user choice and preserves paid configuration and unrelated settings', async () => {
    expect((await request('/ai/settings', 'PUT', { providerMode: 'kilo-free', freeModel: 'a/good:free' })).status).toBe(200);
    const { rows } = await db.query('select user_id,ui_settings,ai_api_key from user_settings order by user_id');
    expect(rows[0]).toMatchObject({ ai_api_key: 'private-one', ui_settings: { general: { theme: 'dark' }, ai: { model: 'existing', providerMode: 'kilo-free', freeModel: 'a/good:free' } } });
    expect(rows[1].ui_settings).toEqual({ ai: { model: 'other' } });
    expect((await request('/ai/settings', 'PUT', { providerMode: 'configured', freeModel: 'a/good:free' })).status).toBe(200);
    expect((await request('/ai/settings')).data.providerMode).toBe('configured');
  });
  it('rejects paid or unknown model selections without persisting them', async () => {
    expect((await request('/ai/settings', 'PUT', { providerMode: 'kilo-free', freeModel: 'a/paid' })).status).toBe(400);
    expect((await request('/ai/settings', 'PUT', { providerMode: 'kilo-free', freeModel: 'a/missing:free' })).status).toBe(400);
    expect((await request('/ai/settings')).data.providerMode).toBe('configured');
  });
  it('tests with a fixed public prompt and anonymous credentials; rate limits are actionable', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) return Response.json(catalog);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer anonymous');
      expect(init?.body).not.toContain('private-one');
      return Response.json({ error: { message: 'rate limited' } }, { status: 429 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await request('/ai/free-models/test', 'POST', { freeModel: 'openrouter/free' });
    expect(result.status).toBe(429);
    expect(result.error.message).toMatch(/限流/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
