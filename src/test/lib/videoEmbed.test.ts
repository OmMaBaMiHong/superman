import { describe, expect, it } from 'vitest';
import {
  extractBilibiliBvid,
  isDouyinUrl,
  resolveVideoEmbed,
} from '../../lib/media/videoEmbed';

describe('视频嵌入解析', () => {
  it('B站标准链接解析 bvid', () => {
    expect(extractBilibiliBvid('https://www.bilibili.com/video/BV1xx411c7mD/')).toBe('BV1xx411c7mD');
    expect(extractBilibiliBvid('https://www.bilibili.com/video/BV1xx411c7mD?p=1')).toBe('BV1xx411c7mD');
    expect(extractBilibiliBvid('https://b23.tv/BV1abc12345')).toBe('BV1abc12345');
  });

  it('非 B站视频路径返回 null', () => {
    expect(extractBilibiliBvid('https://www.bilibili.com/bangumi/play/ep123')).toBeNull();
    expect(extractBilibiliBvid('https://example.com/article')).toBeNull();
    expect(extractBilibiliBvid(null)).toBeNull();
    expect(extractBilibiliBvid('')).toBeNull();
  });

  it('抖音链接识别', () => {
    expect(isDouyinUrl('https://www.douyin.com/video/7234567890')).toBe(true);
    expect(isDouyinUrl('https://v.douyin.com/abc/')).toBe(true);
    expect(isDouyinUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(false);
  });

  it('resolveVideoEmbed：B站给 iframe embedUrl，抖音给外链，其他 null', () => {
    const bili = resolveVideoEmbed('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(bili).toMatchObject({ kind: 'bilibili', bvid: 'BV1xx411c7mD' });
    expect(bili && bili.kind === 'bilibili' ? bili.embedUrl : '').toContain('player.bilibili.com/player.html?bvid=BV1xx411c7mD');
    expect(bili && bili.kind === 'bilibili' ? bili.embedUrl : '').toContain('autoplay=0');

    const douyin = resolveVideoEmbed('https://www.douyin.com/video/7234567890');
    expect(douyin).toMatchObject({ kind: 'douyin' });

    expect(resolveVideoEmbed('https://example.com/a')).toBeNull();
  });
});
