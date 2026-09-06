import { describe, expect, it } from 'vitest';
import { buildCommentIntelPrompt, heuristicCommentAnalysis } from '@/core/comment-intel/analyze';
import type { PublishedPostRow } from '@/core/publish-tracking/repository';
import type { PostCommentRow } from '@/core/comment-intel/repository';

const post = { id: '7', title: '测试视频', postUrl: 'https://x', platform: 'douyin' } as PublishedPostRow;

function makeComment(overrides: Partial<PostCommentRow> = {}): PostCommentRow {
  return {
    id: '1', postId: '7', commentId: 'c1', author: '甲',
    content: '什么时候更新第二期？', likes: 100, replyCount: 0,
    ipLocation: null, commentedAt: null, fetchedAt: '',
    ...overrides,
  };
}

describe('heuristicCommentAnalysis', () => {
  it('摘选高赞评论为 summary，标题带原帖', () => {
    const a = heuristicCommentAnalysis(post, [
      makeComment(),
      makeComment({ commentId: 'c2', content: '求教程链接', likes: 50 }),
    ]);
    expect(a.usedFallback).toBe(true);
    expect(a.title).toContain('测试视频');
    expect(a.summary).toContain('什么时候更新第二期');
    expect(a.summary).toContain('100 赞');
  });

  it('零评论时给占位 summary 不抛错', () => {
    const a = heuristicCommentAnalysis(post, []);
    expect(a.summary).toContain('暂无高赞评论');
  });
});

describe('buildCommentIntelPrompt', () => {
  it('评论内容包 UNTRUSTED 围栏，输出 JSON 模板', () => {
    const p = buildCommentIntelPrompt({
      post,
      comments: [makeComment(), makeComment({ commentId: 'c2', content: '求教程链接', likes: 50 })],
    });
    expect(p).toContain('<<<UNTRUSTED_DATA_START>>>');
    expect(p).toContain('<<<UNTRUSTED_DATA_END>>>');
    expect(p).toContain('什么时候更新第二期');
    expect(p).toContain('[100 赞]');
    expect(p).toContain('"title"');
    expect(p).toContain('"summary"');
    expect(p).toContain('"aiReason"');
  });
});
