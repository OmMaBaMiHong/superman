import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { ConflictError } from '@/server/infra/http/errors';
import {
  backfillDirections,
  resetBackfillRunningStateForTest,
} from '@/core/governance/backfill';

const STRATEGIES = [
  { key: 'money', name: '搞钱', keywordsDsl: '变现 副业', aiHint: '商机', quotaWeight: 30, updatedAt: '2026-09-05T00:00:00Z' },
  { key: 'general', name: '其他', keywordsDsl: '', aiHint: '', quotaWeight: 0, updatedAt: '2026-09-04T00:00:00Z' },
];

const listDirectionStrategiesMock = vi.fn(async () => STRATEGIES);
vi.mock('@/core/governance/directions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/governance/directions')>();
  return {
    ...original,
    listDirectionStrategies: (...args: unknown[]) => listDirectionStrategiesMock(...args),
  };
});

/** 按 SQL 形状分发批次结果的 mock pool。 */
function mockPoolWithBatches(batches: Array<Array<{ id: string; title: string; summary: string | null }>>) {
  let selectCall = 0;
  const updates: Array<readonly unknown[]> = [];
  const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes('from articles')) {
      const rows = batches[selectCall] ?? [];
      selectCall += 1;
      return { rows };
    }
    if (sql.includes('update articles')) {
      updates.push(params ?? []);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query, updates };
}

describe('governance backfill / 存量方向回填（P2c）', () => {
  beforeEach(() => {
    resetBackfillRunningStateForTest();
    listDirectionStrategiesMock.mockClear();
  });

  it('分批处理直到扫完：只动 direction_key is null 的行，返回 scanned/classified', async () => {
    const { pool, updates, query } = mockPoolWithBatches([
      [
        { id: '1', title: '一个副业变现案例', summary: null },
        { id: '2', title: '普通新闻', summary: null },
      ],
      [{ id: '3', title: '另一条普通新闻', summary: null }],
      [],
    ]);
    const result = await backfillDirections(pool, { userId: '42' }, { batchSize: 2 });

    expect(result).toEqual({ scanned: 3, classified: 1, batches: 2 });
    // 两次 select（第二批不足 batchSize 即收尾）+ 3 条 update
    expect(query.mock.calls.filter((c) => String(c[0]).includes('from articles'))).toHaveLength(2);
    expect(updates).toHaveLength(3);
    // 所有 update 都带 direction_key is null 条件 + 用户隔离
    for (const call of query.mock.calls.filter((c) => String(c[0]).includes('update articles'))) {
      expect(String(call[0])).toContain('and direction_key is null');
      expect(String(call[0])).toContain('and user_id = $2');
    }
    // 第一条命中 money，其余落 general
    expect(updates[0]).toEqual(['1', '42', 'money', expect.stringContaining('回填：命中关键词「变现」')]);
    expect(updates[1]?.[2]).toBe('general');
    expect(updates[2]?.[2]).toBe('general');
    // direction_reason 带 algo 版本前缀
    expect(String(updates[0]?.[3])).toContain('[algo d2-w30-t');
  });

  it('没有待回填行时直接返回零', async () => {
    const { pool } = mockPoolWithBatches([[]]);
    const result = await backfillDirections(pool, { userId: '42' });
    expect(result).toEqual({ scanned: 0, classified: 0, batches: 0 });
  });

  it('防重入：进行中再次调用抛 409', async () => {
    let releaseSelect: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { releaseSelect = resolve; });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from articles')) {
        await gate;
        return { rows: [] };
      }
      return { rows: [] };
    });
    const pool = { query } as unknown as Pool;

    const first = backfillDirections(pool, { userId: '42' });
    // 第一次还卡在 select 上，第二次应立即 409
    await expect(backfillDirections(pool, { userId: '42' })).rejects.toBeInstanceOf(ConflictError);
    releaseSelect!();
    await first;
    // 结束后可以再次执行
    const again = await backfillDirections(pool, { userId: '42' });
    expect(again.scanned).toBe(0);
  });

  it('withAi=true：关键词未命中的送 AI，幻觉/低置信落 general', async () => {
    const { pool, updates } = mockPoolWithBatches([
      [
        { id: '1', title: '普通文章A', summary: '讲手工' },
        { id: '2', title: '普通文章B', summary: '讲做菜' },
      ],
      [],
    ]);
    const draft = vi.fn()
      .mockResolvedValueOnce({
        title: 't', summary: 's', aiReason: 'r', qualityScore: 70, usedFallback: false,
        directionKey: 'money', directionReason: '手艺变现', directionConfidence: 0.9,
      })
      .mockResolvedValueOnce({
        title: 't', summary: 's', aiReason: 'r', qualityScore: 70, usedFallback: false,
        directionKey: 'crypto', directionReason: null, directionConfidence: 0.99,
      });
    const result = await backfillDirections(
      pool,
      { userId: '42', withAi: true, aiConfig: { model: 'm', apiBaseUrl: 'u', apiKey: 'k', deepThinkingEnabled: false } },
      { draft },
    );
    expect(result).toEqual({ scanned: 2, classified: 1, batches: 1 });
    expect(draft).toHaveBeenCalledTimes(2);
    expect(updates[0]?.[2]).toBe('money');
    expect(String(updates[0]?.[3])).toContain('AI 分类');
    expect(updates[1]?.[2]).toBe('general');
  });

  it('默认 withAi=false：不调 AI（不花额度）', async () => {
    const { pool } = mockPoolWithBatches([[{ id: '1', title: '普通文章', summary: null }], []]);
    const draft = vi.fn();
    const result = await backfillDirections(pool, { userId: '42' }, { draft });
    expect(result.scanned).toBe(1);
    expect(draft).not.toHaveBeenCalled();
  });
});
