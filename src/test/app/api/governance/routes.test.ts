import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '@/server/infra/http/errors';

const pool = { connect: vi.fn(), query: vi.fn() };
const requireApiSessionMock = vi.fn();
const listGovernanceQueueMock = vi.fn();
const getGovernanceStatsMock = vi.fn();
const approveGovernanceItemMock = vi.fn();
const rejectGovernanceItemMock = vi.fn();
const redraftGovernanceItemMock = vi.fn();
const restoreGovernanceItemMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({ getPool: () => pool }));
vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));
vi.mock('@/server/domains/governance/repository', () => ({
  listGovernanceQueue: (...args: unknown[]) => listGovernanceQueueMock(...args),
  getGovernanceStats: (...args: unknown[]) => getGovernanceStatsMock(...args),
}));
vi.mock('@/server/domains/governance/services/governanceActionsService', () => ({
  approveGovernanceItem: (...args: unknown[]) => approveGovernanceItemMock(...args),
  rejectGovernanceItem: (...args: unknown[]) => rejectGovernanceItemMock(...args),
  redraftGovernanceItem: (...args: unknown[]) => redraftGovernanceItemMock(...args),
  restoreGovernanceItem: (...args: unknown[]) => restoreGovernanceItemMock(...args),
}));

import { GET as queueGET } from '@/app/api/governance/queue/route';
import { GET as statsGET } from '@/app/api/governance/stats/route';
import { POST as approvePOST } from '@/app/api/governance/items/[id]/approve/route';
import { POST as rejectPOST } from '@/app/api/governance/items/[id]/reject/route';
import { POST as redraftPOST } from '@/app/api/governance/items/[id]/redraft/route';
import { POST as restorePOST } from '@/app/api/governance/items/[id]/restore/route';

const SESSION = { userId: '42', role: 'member' as const, sessionVersion: 1 };
const UNAUTHORIZED = {
  response: new Response(JSON.stringify({ ok: false }), { status: 401 }),
};

function itemParams(id = '11') {
  return { params: Promise.resolve({ id }) };
}

describe('/api/governance 鉴权', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset();
    listGovernanceQueueMock.mockReset();
    getGovernanceStatsMock.mockReset();
    approveGovernanceItemMock.mockReset();
    rejectGovernanceItemMock.mockReset();
    redraftGovernanceItemMock.mockReset();
    restoreGovernanceItemMock.mockReset();
  });

  it('未登录时所有端点直接返回 401 响应', async () => {
    requireApiSessionMock.mockResolvedValue(UNAUTHORIZED);
    const responses = [
      await queueGET(new Request('http://localhost/api/governance/queue')),
      await statsGET(),
      await approvePOST(new Request('http://localhost', { method: 'POST' }), itemParams()),
      await rejectPOST(new Request('http://localhost', { method: 'POST', body: '{}' }), itemParams()),
      await redraftPOST(new Request('http://localhost', { method: 'POST', body: '{}' }), itemParams()),
      await restorePOST(new Request('http://localhost', { method: 'POST' }), itemParams()),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
    }
    expect(listGovernanceQueueMock).not.toHaveBeenCalled();
    expect(approveGovernanceItemMock).not.toHaveBeenCalled();
  });
});

describe('/api/governance/queue', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset().mockResolvedValue(SESSION);
    listGovernanceQueueMock.mockReset().mockResolvedValue({ items: [], total: 0 });
  });

  it('按当前登录用户过滤，解析 status/categoryId/分页参数', async () => {
    const res = await queueGET(
      new Request('http://localhost/api/governance/queue?status=candidate&categoryId=7&page=2&pageSize=10'),
    );
    expect(res.status).toBe(200);
    expect(listGovernanceQueueMock).toHaveBeenCalledWith(pool, {
      userId: '42',
      statuses: ['candidate'],
      categoryId: '7',
      page: 2,
      pageSize: 10,
    });
  });

  it('缺省参数：不过滤状态（candidate+pending 默认）、page=1、pageSize=20', async () => {
    await queueGET(new Request('http://localhost/api/governance/queue'));
    expect(listGovernanceQueueMock).toHaveBeenCalledWith(pool, {
      userId: '42',
      statuses: undefined,
      categoryId: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it('非法 status / categoryId 返回 400', async () => {
    const res1 = await queueGET(new Request('http://localhost/api/governance/queue?status=bogus'));
    expect(res1.status).toBe(400);
    const res2 = await queueGET(new Request('http://localhost/api/governance/queue?categoryId=abc'));
    expect(res2.status).toBe(400);
    expect(listGovernanceQueueMock).not.toHaveBeenCalled();
  });
});

describe('/api/governance/stats', () => {
  it('返回今日统计且按用户过滤', async () => {
    requireApiSessionMock.mockReset().mockResolvedValue(SESSION);
    getGovernanceStatsMock.mockReset().mockResolvedValue({
      todayPending: 2,
      todayArchived: 5,
      todayFetchSucceeded: 10,
      todayFetchFailed: 1,
      queueSize: 7,
    });
    const res = await statsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ todayPending: 2, todayArchived: 5, queueSize: 7 });
    expect(getGovernanceStatsMock).toHaveBeenCalledWith(pool, '42');
  });
});

describe('/api/governance/items/[id] 状态迁移', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset().mockResolvedValue(SESSION);
    approveGovernanceItemMock.mockReset();
    rejectGovernanceItemMock.mockReset();
    redraftGovernanceItemMock.mockReset();
    restoreGovernanceItemMock.mockReset();
  });

  it('approve：成功返回条目，携带当前用户', async () => {
    approveGovernanceItemMock.mockResolvedValue({ id: '11', governanceStatus: 'archived' });
    const res = await approvePOST(new Request('http://localhost', { method: 'POST' }), itemParams());
    expect(res.status).toBe(200);
    expect(approveGovernanceItemMock).toHaveBeenCalledWith(pool, { id: '11', userId: '42' });
  });

  it('approve：条目不存在 404，非法迁移 409', async () => {
    approveGovernanceItemMock.mockRejectedValue(new NotFoundError('治理条目不存在'));
    expect(
      (await approvePOST(new Request('http://localhost', { method: 'POST' }), itemParams())).status,
    ).toBe(404);

    approveGovernanceItemMock.mockRejectedValue(
      new ConflictError('当前状态（used）不允许迁移到 archived'),
    );
    expect(
      (await approvePOST(new Request('http://localhost', { method: 'POST' }), itemParams())).status,
    ).toBe(409);
  });

  it('approve：非法 id 返回 400，不触碰服务层', async () => {
    const res = await approvePOST(
      new Request('http://localhost', { method: 'POST' }),
      itemParams('abc'),
    );
    expect(res.status).toBe(400);
    expect(approveGovernanceItemMock).not.toHaveBeenCalled();
  });

  it('reject：透传驳回理由', async () => {
    rejectGovernanceItemMock.mockResolvedValue({ id: '11', governanceStatus: 'rejected' });
    const res = await rejectPOST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: '低质量' }),
      }),
      itemParams(),
    );
    expect(res.status).toBe(200);
    expect(rejectGovernanceItemMock).toHaveBeenCalledWith(pool, {
      id: '11',
      reason: '低质量',
      userId: '42',
    });
  });

  it('reject：body 缺失时理由默认空串', async () => {
    rejectGovernanceItemMock.mockResolvedValue({ id: '11', governanceStatus: 'rejected' });
    const res = await rejectPOST(
      new Request('http://localhost', { method: 'POST' }),
      itemParams(),
    );
    expect(res.status).toBe(200);
    expect(rejectGovernanceItemMock).toHaveBeenCalledWith(pool, {
      id: '11',
      reason: '',
      userId: '42',
    });
  });

  it('redraft：返回重拟结果并透传理由', async () => {
    redraftGovernanceItemMock.mockResolvedValue({
      item: { id: '11', governanceStatus: 'pending', redraftCount: 1 },
      draft: { title: '新标题', summary: '新摘要', aiReason: '已修正', qualityScore: 88, usedFallback: false },
    });
    const res = await redraftPOST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: '摘要太泛' }),
      }),
      itemParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.item.redraftCount).toBe(1);
    expect(redraftGovernanceItemMock).toHaveBeenCalledWith(pool, {
      id: '11',
      reason: '摘要太泛',
      userId: '42',
    });
  });

  it('redraft：已归档条目由服务层抛 409', async () => {
    redraftGovernanceItemMock.mockRejectedValue(
      new ConflictError('当前状态（archived）不允许打回重拟'),
    );
    const res = await redraftPOST(
      new Request('http://localhost', { method: 'POST', body: '{}' }),
      itemParams(),
    );
    expect(res.status).toBe(409);
  });

  it('restore：rejected → archived', async () => {
    restoreGovernanceItemMock.mockResolvedValue({ id: '11', governanceStatus: 'archived' });
    const res = await restorePOST(new Request('http://localhost', { method: 'POST' }), itemParams());
    expect(res.status).toBe(200);
    expect(restoreGovernanceItemMock).toHaveBeenCalledWith(pool, { id: '11', userId: '42' });
  });
});
