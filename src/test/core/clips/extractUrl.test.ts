import { describe, expect, it } from 'vitest';
import { extractFirstUrl, hasUrl } from '@/lib/url/extractUrl';

describe('extractFirstUrl', () => {
  it('extracts the douyin short link from a messy share blob', () => {
    const blob =
      '0.20 :8pm srr:/ 03/28 Z@m.Dh 这个博主从不接广告，年收入却超过200万 用ai解析姜胡说的系统，并用ai自动剪辑出来的一版视频。 # codex剪辑视频 # workbuddy剪辑视频 # 赚钱思维  https://v.douyin.com/jZ9GwlO4LJQ/ 复制此链接，打开Dou音搜索，直接观看视频！';
    expect(extractFirstUrl(blob)).toBe('https://v.douyin.com/jZ9GwlO4LJQ/');
  });

  it('strips trailing chinese punctuation', () => {
    expect(extractFirstUrl('看这个 https://example.com/a?b=1，很赞')).toBe('https://example.com/a?b=1');
  });

  it('returns null when there is no link', () => {
    expect(extractFirstUrl('纯文本没有链接')).toBeNull();
    expect(hasUrl('纯文本没有链接')).toBe(false);
  });

  it('handles a clean url', () => {
    expect(extractFirstUrl('https://www.douyin.com/user/MS4wLjABAAAAxyz')).toBe(
      'https://www.douyin.com/user/MS4wLjABAAAAxyz',
    );
  });
});
