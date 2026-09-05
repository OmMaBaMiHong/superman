/**
 * 内容形态推断：图文 image / 视频 video / 纯文案 text（预留 live 直播位）。
 * 纯函数，服务端在 SQL 取信号位后调用；前端徽章直接消费 contentType 字段。
 */

export type ContentType = 'video' | 'image' | 'text';

const VIDEO_LINK_RE =
  /(bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|youtube\.com|youtu\.be|kuaishou\.com|ixigua\.com|weishi\.qq\.com)/i;

const VIDEO_PLATFORMS = new Set([
  'douyin',
  'bilibili',
  'kuaishou',
  'xigua',
  'weishi',
  'haokan',
  'shipinhao',
  'youtube',
]);

/** 文章（治理队列/详情）：view=video 或视频域链接 → video；有封面/内嵌图 → image；否则 text。 */
export function inferArticleContentType(input: {
  feedView?: string | null;
  link?: string | null;
  hasPreviewImage?: boolean;
  hasInlineImage?: boolean;
}): ContentType {
  if (input.feedView === 'video') return 'video';
  if (input.link && VIDEO_LINK_RE.test(input.link)) return 'video';
  if (input.feedView === 'picture') return 'image';
  if (input.hasPreviewImage || input.hasInlineImage) return 'image';
  return 'text';
}

/** 热榜条目：视频平台/视频链接 → video；payload 带封面图 → image；否则 text。 */
export function inferTrendContentType(input: {
  platform: string;
  url?: string | null;
  payload?: Record<string, unknown>;
}): ContentType {
  if (VIDEO_PLATFORMS.has(input.platform.toLowerCase())) return 'video';
  if (input.url && VIDEO_LINK_RE.test(input.url)) return 'video';

  const payload = input.payload ?? {};
  for (const key of ['cover', 'image', 'pic', 'thumbnail', 'coverUrl', 'imageUrl']) {
    const value = payload[key];
    if (typeof value === 'string' && /^https?:\/\//.test(value)) return 'image';
  }
  return 'text';
}
