import { describe, expect, it, vi } from 'vitest';
import { createClip } from '@/core/clips/service';
import type { Queryable } from '@/plugin/host/db';

/** 只对「按链接查已有收藏」返回命中行，其余查询返回空。 */
function dbWithExistingClip(): { db: Queryable; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (sql: string) => {
    if (/from articles/i.test(sql)) {
      return {
        rows: [
          {
            id: '892596',
            directionKey: 'money',
            directionReason: '已有收藏',
            summary: '既有摘要',
            qualityScore: 80,
          },
        ],
      };
    }
    return { rows: [] };
  });
  return { db: { query } as unknown as Queryable, query };
}

function dbEmpty(): { db: Queryable; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => ({ rows: [] }));
  return { db: { query } as unknown as Queryable, query };
}

describe('clips/service · 按 sourceUrl 去重', () => {
  it('同一链接已收藏 → 复用既有 article，不新建，返回 alreadyExists', async () => {
    const { db, query } = dbWithExistingClip();
    const result = await createClip(db, {
      userId: '1',
      contentText: '婚礼上新娘问新郎一个问题……',
      sourceUrl: 'https://v.douyin.com/FnyrvzzHWG4/',
    });

    expect(result.alreadyExists).toBe(true);
    expect(result.articleId).toBe('892596');
    expect(result.directionKey).toBe('money');
    expect(result.qualityScore).toBe(80);

    // 命中去重：不应有任何 insert into articles
    const inserted = query.mock.calls.some(([sql]) => /insert into articles/i.test(String(sql)));
    expect(inserted).toBe(false);
    // 但应刷新 clips 原文快照（upsert）
    const upserted = query.mock.calls.some(([sql]) => /insert into clips/i.test(String(sql)));
    expect(upserted).toBe(true);
  });

  it('没有 sourceUrl 时不做链接去重（走正常入库路径）', async () => {
    const { db, query } = dbEmpty();
    // 无 sourceUrl：不会调用「按链接查」；此处只验证未短路复用。
    await expect(
      createClip(db, { userId: '1', contentText: '一段纯文本想法' }),
    ).rejects.toBeDefined();
    const lookedUpByLink = query.mock.calls.some(
      ([sql]) => /from articles[\s\S]*origin = 'clipboard'/i.test(String(sql)),
    );
    expect(lookedUpByLink).toBe(false);
  });
});
