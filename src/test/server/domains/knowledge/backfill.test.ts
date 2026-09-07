import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { backfillKnowledge } from '@/core/knowledge/backfill';

vi.mock('@/server/domains/users/userScope', () => ({ normalizeUserId: (v?: string) => v ?? '1' }));

describe('backfillKnowledge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('无向量文章逐篇补索引；单篇失败计 failed 不打断', async () => {
    const db = {
      query: vi.fn()
        // 待回填清单：2 篇（含 1 篇空内容）
        .mockResolvedValueOnce({
          rows: [
            { id: '1', title: '甲', body: '有内容的正文。' },
            { id: '2', title: '乙', body: '   ' },
          ],
        })
        // 剩余量估算
        .mockResolvedValueOnce({ rows: [{ remaining: '5' }] }),
    };
    const indexOne = vi.fn()
      .mockResolvedValueOnce({ chunks: 3 })   // 甲：成功
      .mockRejectedValueOnce(new Error('embedding 挂了')); // 乙：失败
    const result = await backfillKnowledge(db as unknown as Pool, { limit: 50, indexOne: indexOne as never });
    expect(result).toEqual({ scanned: 2, indexed: 1, failed: 1, remaining: 5 });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(String(db.query.mock.calls[0][0])).toContain('left join knowledge_embeddings');
  });

  it('没有待回填文章时直接返回零', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const indexOne = vi.fn();
    const result = await backfillKnowledge(db as unknown as Pool, { limit: 20, indexOne: indexOne as never });
    expect(result).toEqual({ scanned: 0, indexed: 0, failed: 0, remaining: null });
    expect(indexOne).not.toHaveBeenCalled();
  });
});
