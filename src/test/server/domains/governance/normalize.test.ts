import { describe, expect, it } from 'vitest';
import { normalizeHeadline, normalizeUrl } from '@/core/governance/normalize';

describe('governance normalize / normalizeHeadline', () => {
  it('NFKC：全角字符折叠为半角', () => {
    expect(normalizeHeadline('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeHeadline('ＡＩ时代')).toBe('ai时代');
  });

  it('去空白（含全角空格）与大小写差异', () => {
    expect(normalizeHeadline('Hello　 World')).toBe('helloworld');
    expect(normalizeHeadline('  OpenAI 发布 新模型 ')).toBe('openai发布新模型');
  });

  it('去标点/符号/emoji：尾部表情差异不影响判同', () => {
    expect(normalizeHeadline('某事件刷屏了🔥🔥')).toBe(normalizeHeadline('某事件刷屏了'));
    expect(normalizeHeadline('重磅！某公司官宣【新品】')).toBe(normalizeHeadline('重磅 某公司官宣 新品'));
  });

  it('跨平台合并语义：同一事件不同写法归一后相同', () => {
    expect(normalizeHeadline('ＸＸ发布会全程回顾✨')).toBe(normalizeHeadline('xx发布会全程回顾'));
  });

  it('空串与纯符号串归一后为空', () => {
    expect(normalizeHeadline('')).toBe('');
    expect(normalizeHeadline('🔥🔥！！')).toBe('');
  });
});

describe('governance normalize / normalizeUrl', () => {
  it('剥离 utm_* 追踪参数与 hash', () => {
    expect(normalizeUrl('https://example.com/a?utm_source=rss&utm_medium=feed&id=1#top'))
      .toBe('https://example.com/a?id=1');
  });

  it('剥离 spm/fbclid/gclid 等常见追踪参数', () => {
    expect(normalizeUrl('https://example.com/a?spm=abc.123&fbclid=x&gclid=y&p=2'))
      .toBe('https://example.com/a?p=2');
  });

  it('同一文章带不带追踪串归一后相同（去重语义）', () => {
    const bare = normalizeUrl('https://example.com/post/42');
    expect(normalizeUrl('https://example.com/post/42?utm_campaign=x&utm_source=y')).toBe(bare);
    expect(normalizeUrl('https://example.com/post/42#comments')).toBe(bare);
  });

  it('非法 URL 原样返回（trim）', () => {
    expect(normalizeUrl('  not a url  ')).toBe('not a url');
  });

  it('保留业务参数与路径大小写', () => {
    expect(normalizeUrl('https://example.com/Path/To?id=7&page=2'))
      .toBe('https://example.com/Path/To?id=7&page=2');
  });
});
