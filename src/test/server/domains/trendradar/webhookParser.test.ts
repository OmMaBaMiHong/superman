import { describe, expect, it } from 'vitest';
import { parseTrendRadarWebhookPayload } from '@/server/domains/trendradar/webhookParser';

describe('trendradar webhookParser / 容错解析', () => {
  it('解析标准 generic_webhook 格式（平台头 + 编号条目 + 链接 + 排名）', () => {
    const parsed = parseTrendRadarWebhookPayload({
      title: '当前榜单',
      content: [
        '**【微博】**',
        '1. [手机涨价](https://s.weibo.com/a) **[1]** 📈',
        '2. 另一条热搜 [3 - 5]',
        '',
        '**【知乎】**',
        '1. [如何看待某事](https://www.zhihu.com/q/1) [2]',
      ].join('\n'),
      token: 'secret',
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.reportType).toBe('当前榜单');
    expect(parsed?.token).toBe('secret');
    expect(parsed?.items).toHaveLength(3);
    expect(parsed?.items[0]).toEqual({
      platform: '微博',
      title: '手机涨价',
      url: 'https://s.weibo.com/a',
      rank: 1,
    });
    expect(parsed?.items[1]).toEqual({
      platform: '微博',
      title: '另一条热搜',
      url: null,
      rank: 3,
    });
    expect(parsed?.items[2]).toMatchObject({ platform: '知乎', rank: 2 });
  });

  it('支持 ## 标题式平台头与 1、条目', () => {
    const parsed = parseTrendRadarWebhookPayload({
      content: '## 百度\n1、某个百度热搜',
    });
    expect(parsed?.items).toEqual([
      { platform: '百度', title: '某个百度热搜', url: null, rank: 1 },
    ]);
  });

  it('无平台头的条目归入 unknown 平台', () => {
    const parsed = parseTrendRadarWebhookPayload({ content: '1. 孤零零的条目' });
    expect(parsed?.items[0]?.platform).toBe('unknown');
  });

  it('统计类标题不被误识别为平台', () => {
    const parsed = parseTrendRadarWebhookPayload({
      content: '**热点词汇统计**\n1. 真正的条目',
    });
    expect(parsed?.items[0]?.platform).toBe('unknown');
  });

  it('空内容 / 非对象 body 返回 null', () => {
    expect(parseTrendRadarWebhookPayload(null)).toBeNull();
    expect(parseTrendRadarWebhookPayload({})).toBeNull();
    expect(parseTrendRadarWebhookPayload({ content: '   ' })).toBeNull();
  });

  it('纯文本 body 也可解析（某些网关直接 POST 文本）', () => {
    const parsed = parseTrendRadarWebhookPayload('【贴吧】\n1. 贴吧热帖');
    expect(parsed?.items[0]).toMatchObject({ platform: '贴吧', title: '贴吧热帖' });
  });

  it('解析不出条目也保留原文（不报错）', () => {
    const parsed = parseTrendRadarWebhookPayload({ content: '没有任何编号行\n只是散文' });
    expect(parsed).not.toBeNull();
    expect(parsed?.items).toHaveLength(0);
    expect(parsed?.content).toContain('散文');
  });
});
