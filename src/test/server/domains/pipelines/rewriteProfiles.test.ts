import { describe, expect, it } from 'vitest';
import {
  REWRITE_PLATFORMS,
  REWRITE_PROFILES,
  buildRewritePrompt,
  isRewritePlatform,
  parseRewriteOutput,
} from '@/server/domains/pipelines/rewriteProfiles';

const INPUT = {
  title: '原文标题',
  contentText: '原文正文内容',
  sourceUrl: 'https://example.com/a',
};

describe('pipelines rewriteProfiles', () => {
  it('三平台 profile 齐备且 prompt 带围栏与 JSON 要求', () => {
    expect(REWRITE_PLATFORMS).toEqual(['wechat', 'xhs', 'novel']);
    for (const platform of REWRITE_PLATFORMS) {
      const profile = REWRITE_PROFILES[platform];
      const prompt = buildRewritePrompt(profile, INPUT);
      expect(prompt).toContain('<<<UNTRUSTED_DATA_START>>>');
      expect(prompt).toContain('<<<UNTRUSTED_DATA_END>>>');
      expect(prompt).toContain('不可信');
      expect(prompt).toContain('严格 JSON');
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"body"');
      expect(prompt).toContain(profile.name);
    }
  });

  it('平台风格约束写进 prompt', () => {
    expect(buildRewritePrompt(REWRITE_PROFILES.wechat, INPUT)).toContain('1500-2500');
    expect(buildRewritePrompt(REWRITE_PROFILES.xhs, INPUT)).toContain('800');
    expect(buildRewritePrompt(REWRITE_PROFILES.xhs, INPUT)).toContain('emoji');
    expect(buildRewritePrompt(REWRITE_PROFILES.novel, INPUT)).toContain('场景化叙事');
  });

  it('reduceSimilarity=true 时追加降重指令', () => {
    const normal = buildRewritePrompt(REWRITE_PROFILES.wechat, INPUT);
    const reduce = buildRewritePrompt(REWRITE_PROFILES.wechat, { ...INPUT, reduceSimilarity: true });
    expect(normal).not.toContain('降重要求');
    expect(reduce).toContain('降重要求');
    expect(reduce).toContain('严禁整句照搬原文');
  });

  it('isRewritePlatform 校验取值', () => {
    expect(isRewritePlatform('wechat')).toBe(true);
    expect(isRewritePlatform('douyin')).toBe(false);
    expect(isRewritePlatform(null)).toBe(false);
  });
});

describe('pipelines parseRewriteOutput', () => {
  it('解析严格 JSON，容错 ```json 围栏', () => {
    expect(parseRewriteOutput('{"title":"t","body":"b"}')).toEqual({ title: 't', body: 'b' });
    expect(parseRewriteOutput('```json\n{"title":"t","body":"b"}\n```')).toEqual({
      title: 't',
      body: 'b',
    });
  });

  it('缺 title 或 body 抛错', () => {
    expect(() => parseRewriteOutput('{"title":"t"}')).toThrow(/title 或 body/);
    expect(() => parseRewriteOutput('{"body":"b"}')).toThrow(/title 或 body/);
    expect(() => parseRewriteOutput('不是 JSON')).toThrow();
  });
});
