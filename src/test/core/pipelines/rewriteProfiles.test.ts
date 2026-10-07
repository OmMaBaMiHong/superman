import { describe, expect, it } from 'vitest';
import { REWRITE_PROFILES, buildRewritePrompt } from '@/core/pipelines/rewriteProfiles';

describe('pipelines/rewriteProfiles · 收藏想法注入', () => {
  it('无备注时不出现「用户要求」段', () => {
    const prompt = buildRewritePrompt(REWRITE_PROFILES.wechat, {
      title: '标题',
      contentText: '正文',
    });
    expect(prompt).not.toContain('用户要求');
    expect(prompt).toContain('<<<UNTRUSTED_DATA_START>>>');
  });

  it('有备注时作为「用户要求」注入，优先满足', () => {
    const prompt = buildRewritePrompt(REWRITE_PROFILES.xhs, {
      title: '标题',
      contentText: '正文',
      userNote: '这条内容讲两性冲突，适合做成短剧，重点突出反转',
    });
    expect(prompt).toContain('用户要求');
    expect(prompt).toContain('这条内容讲两性冲突，适合做成短剧，重点突出反转');
  });

  it('备注中的控制字符被剔除', () => {
    const prompt = buildRewritePrompt(REWRITE_PROFILES.novel, {
      title: 't',
      contentText: 'c',
      userNote: 'a\u0000b',
    });
    expect(prompt).toContain('a b');
  });
});
