import { describe, expect, it, vi } from 'vitest';
import { parseCommentTime, upsertPostComments } from '@/core/comment-intel/repository';
import type { CrawlerComment } from '@/core/crawlerClient';

function makeComment(overrides: Partial<CrawlerComment> = {}): CrawlerComment {
  return {
    cid: 'c1', text: 'a', user: 'u', likes: 1, time: '1730000000', replyCount: 0,
    platform: 'douyin', postId: '712', ipLocation: null,
    ...overrides,
  };
}

describe('parseCommentTime', () => {
  it('秒级/毫秒级 unix 解析为 ISO，非法输入返回 null', () => {
    expect(parseCommentTime('1730000000')).toBe(new Date(1730000000 * 1000).toISOString());
    expect(parseCommentTime('1730000000000')).toBe(new Date(1730000000000).toISOString());
    expect(parseCommentTime('')).toBeNull();
    expect(parseCommentTime('abc')).toBeNull();
    expect(parseCommentTime('0')).toBeNull();
  });
});

describe('upsertPostComments', () => {
  it('空列表不发 SQL', async () => {
    const query = vi.fn();
    const n = await upsertPostComments({ query } as never, '7', []);
    expect(n).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('批量 upsert 返回新插入计数（on conflict 刷新不计新）', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ inserted: true }, { inserted: false }, { inserted: true }],
    });
    const db = { query } as never;
    const n = await upsertPostComments(db, '7', [
      makeComment(), makeComment({ cid: 'c2' }), makeComment({ cid: 'c3' }),
    ]);
    expect(n).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('on conflict (post_id, comment_id) do update');
    expect(sql).toContain('(xmax = 0) as inserted');
    expect(values).toHaveLength(27); // 3 条 × 9 参数
  });
});
