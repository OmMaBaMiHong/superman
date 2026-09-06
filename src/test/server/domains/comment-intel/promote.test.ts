import { describe, expect, it, vi } from 'vitest';
import { commentIntelDedupeKey, promoteCommentCandidate } from '@/core/comment-intel/promote';
import type { PublishedPostRow } from '@/core/publish-tracking/repository';
import type { CommentAnalysis } from '@/core/comment-intel/analyze';

const post = {
  id: '7', title: '测试视频', postUrl: 'https://x', platform: 'douyin', userId: '42',
} as PublishedPostRow;
const analysis: CommentAnalysis = {
  title: '观众在问更新', summary: 's', aiReason: 'r', usedFallback: false,
};

vi.mock('@/core/notify/service', () => ({ notify: vi.fn().mockResolvedValue({}) }));
vi.mock('@/core/governance/directions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/governance/directions')>();
  return { ...original, listDirectionStrategies: vi.fn().mockResolvedValue([]) };
});
const insertArticleMock = vi.fn().mockResolvedValue({ id: '99' });
vi.mock('@/server/domains/articles/repositories/articlesRepo', () => ({
  insertArticleIgnoreDuplicate: (...a: unknown[]) => insertArticleMock(...a),
}));

describe('commentIntelDedupeKey', () => {
  it('同一分析内容得到稳定 key，前缀含 postId', () => {
    expect(commentIntelDedupeKey('7', analysis)).toBe(commentIntelDedupeKey('7', analysis));
    expect(commentIntelDedupeKey('7', analysis)).toMatch(/^comment-intel:7:[0-9a-f]{8}$/);
  });
});

describe('promoteCommentCandidate', () => {
  it('72h 冷却期内不重复晋升', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: '1' }] }) };
    const result = await promoteCommentCandidate(db as never, { post, analysis, userId: '42' });
    expect(result).toEqual({ promoted: false, articleId: null, reason: 'cooldown' });
    expect(insertArticleMock).not.toHaveBeenCalled();
  });

  it('冷却期外晋升为 candidate 并写 comment_intel 通知', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })   // 冷却检查：无近期候选
        .mockResolvedValueOnce({ rows: [{ id: '5' }] }), // 合成 feed upsert
    };
    const { notify } = await import('@/core/notify/service');
    const result = await promoteCommentCandidate(db as never, { post, analysis, userId: '42' });
    expect(result).toEqual({ promoted: true, articleId: '99' });
    expect(insertArticleMock).toHaveBeenCalledTimes(1);
    const [, input] = insertArticleMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input).toMatchObject({
      dedupeKey: expect.stringMatching(/^comment-intel:7:[0-9a-f]{8}$/),
      governance: expect.objectContaining({ status: 'candidate', directionKey: 'general' }),
    });
    expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ kind: 'comment_intel' }));
  });
});
