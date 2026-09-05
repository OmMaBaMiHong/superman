import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = { query: vi.fn() };
const getServerEnvMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/infra/env', () => ({
  getServerEnv: () => getServerEnvMock(),
}));

import { POST } from '@/app/api/ingest/trendradar/route';

const TOKEN = 'test-ingest-token';

function makeRequest(body: unknown, headers: Record<string, string> = {}, query = ''): Request {
  return new Request(`http://localhost/api/ingest/trendradar${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('/api/ingest/trendradar', () => {
  beforeEach(() => {
    getServerEnvMock.mockReturnValue({ TRENDRADAR_INGEST_TOKEN: TOKEN });
    // resolveTrendRadarOwnerUserId → admin；后续 upsert 全部成功
    pool.query.mockResolvedValue({ rows: [{ id: '1' }] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('错 token → 401', async () => {
    const res = await POST(
      makeRequest({ title: 't', content: '1. x' }, { 'x-ingest-token': 'wrong' }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it('缺 token → 401', async () => {
    const res = await POST(makeRequest({ title: 't', content: '1. x' }));
    expect(res.status).toBe(401);
  });

  it('未配置 env token → 503（通道未启用）', async () => {
    getServerEnvMock.mockReturnValue({ TRENDRADAR_INGEST_TOKEN: undefined });
    const res = await POST(
      makeRequest({ title: 't', content: '1. x' }, { 'x-ingest-token': TOKEN }),
    );
    expect(res.status).toBe(503);
  });

  it('X-Ingest-Token 头鉴权成功并 upsert 条目', async () => {
    const res = await POST(
      makeRequest(
        {
          title: '当前榜单',
          content: '**【微博】**\n1. [热搜一](https://s.weibo.com/a) [1]\n2. 热搜二',
        },
        { 'x-ingest-token': TOKEN },
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ received: true, parsed: 2, upserted: 2 });
    // 第一条 SQL 是管理员归属查询，其后是 upsert
    const upsertSql = String(pool.query.mock.calls[1][0]);
    expect(upsertSql).toContain('insert into trend_radar_items');
  });

  it('body.token 回落鉴权（generic_webhook 无法自定义 header）', async () => {
    const res = await POST(makeRequest({ title: 't', content: '1. x', token: TOKEN }));
    expect(res.status).toBe(200);
  });

  it('?token= 查询参数回落鉴权', async () => {
    const res = await POST(makeRequest({ title: 't', content: '1. x' }, {}, `?token=${TOKEN}`));
    expect(res.status).toBe(200);
  });

  it('无效 body → 400', async () => {
    const res = await POST(makeRequest({ hello: 'world' }, { 'x-ingest-token': TOKEN }));
    expect(res.status).toBe(400);
  });

  it('解析不出条目也返回 200（原文已入 payload_json 的容错路径）', async () => {
    const res = await POST(
      makeRequest({ title: 't', content: '没有编号行的散文' }, { 'x-ingest-token': TOKEN }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.parsed).toBe(0);
    expect(json.data.upserted).toBe(0);
  });
});
