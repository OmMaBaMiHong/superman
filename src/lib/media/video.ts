export type VideoProvider = 'youtube' | 'bilibili' | 'douyin' | 'generic';

export interface ArticleVideoMeta {
  provider: VideoProvider;
  videoId: string;
  embedUrl: string;
  canonicalUrl: string;
  thumbnailUrl: string;
}

export interface ArticleVideoInput {
  link?: string | null;
  content?: string | null;
  previewImage?: string | null;
  mediaAttachments?: Array<{ url?: string | null; mimeType?: string | null }> | null;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function extractUrlsFromHtml(value: string): string[] {
  return Array.from(value.matchAll(/https?:\/\/[^"'<>\s)]+/gi), (match) =>
    match[0].replace(/[.,;!?]+$/, ''),
  );
}

// ===== YouTube =====
const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]{6,}$/;

function getYouTubeVideoId(value: string): string | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id && YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (hostname !== 'youtube.com' && hostname !== 'm.youtube.com') {
    return null;
  }

  if (parsed.pathname === '/watch') {
    const id = parsed.searchParams.get('v');
    return id && YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  const [kind, id] = parsed.pathname.split('/').filter(Boolean);
  if ((kind === 'embed' || kind === 'shorts') && id && YOUTUBE_VIDEO_ID_PATTERN.test(id)) {
    return id;
  }

  return null;
}

// ===== Bilibili =====
const BILIBILI_VIDEO_PATTERN = /^BV[\w]{8,}$/i;

function isBilibiliHost(hostname: string): boolean {
  return hostname === 'bilibili.com' || hostname === 'www.bilibili.com' || hostname === 'b23.tv';
}

function getBilibiliVideoId(value: string): string | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!isBilibiliHost(hostname)) return null;

  // bilibili.com/video/BVxxx
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] === 'video' && segments[1] && BILIBILI_VIDEO_PATTERN.test(segments[1])) {
    return segments[1];
  }

  // b23.tv short link — we can't extract BV id from the URL alone, but it's still a video
  if (hostname === 'b23.tv') {
    return parsed.pathname.replace(/^\//, '') || 'unknown';
  }

  return null;
}

// ===== Douyin =====
function isDouyinHost(hostname: string): boolean {
  return hostname === 'douyin.com' || hostname === 'www.douyin.com' ||
    hostname.endsWith('.douyin.com') || hostname === 'iesdouyin.com' || hostname.endsWith('.iesdouyin.com');
}

function getDouyinVideoId(value: string): string | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!isDouyinHost(hostname)) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if ((segments[0] === 'video' || segments[0] === 'note') && segments[1]) {
    return segments[1];
  }

  return null;
}

// ===== Generic video detection =====
const VIDEO_LINK_HOSTS = new Set([
  'bilibili.com', 'www.bilibili.com', 'b23.tv',
  'douyin.com', 'www.douyin.com', 'iesdouyin.com',
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
]);

function isKnownVideoLinkHost(hostname: string): boolean {
  if (VIDEO_LINK_HOSTS.has(hostname)) return true;
  return Array.from(VIDEO_LINK_HOSTS).some((h) => hostname.endsWith(`.${h}`));
}

function detectGenericVideoLink(value: string): string | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (isKnownVideoLinkHost(hostname)) {
    return parsed.pathname.replace(/^\//, '') || 'unknown';
  }
  return null;
}

// ===== Builders =====
function buildMeta(
  provider: VideoProvider,
  videoId: string,
  url: string,
  previewImage?: string | null,
): ArticleVideoMeta {
  switch (provider) {
    case 'youtube':
      return {
        provider: 'youtube',
        videoId,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    case 'bilibili':
      return {
        provider: 'bilibili',
        videoId,
        embedUrl: `https://player.bilibili.com/player.html?bvid=${videoId}`,
        canonicalUrl: `https://www.bilibili.com/video/${videoId}`,
        thumbnailUrl: previewImage ?? '',
      };
    case 'douyin':
      return {
        provider: 'douyin',
        videoId,
        embedUrl: '',
        canonicalUrl: url,
        thumbnailUrl: previewImage ?? '',
      };
    case 'generic':
      return {
        provider: 'generic',
        videoId,
        embedUrl: '',
        canonicalUrl: url,
        thumbnailUrl: previewImage ?? '',
      };
  }
}

export function getArticleVideoMeta(input: ArticleVideoInput): ArticleVideoMeta | null {
  const candidateUrls = [
    input.link,
    ...(input.mediaAttachments ?? [])
      .filter((attachment) => {
        const mimeType = attachment.mimeType?.toLowerCase() ?? '';
        return mimeType.startsWith('video/');
      })
      .map((attachment) => attachment.url),
    ...extractUrlsFromHtml(input.content ?? ''),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const url of candidateUrls) {
    // YouTube
    const ytId = getYouTubeVideoId(url);
    if (ytId) return buildMeta('youtube', ytId, url, input.previewImage);

    // Bilibili
    const bvId = getBilibiliVideoId(url);
    if (bvId) return buildMeta('bilibili', bvId, url, input.previewImage);

    // Douyin
    const dyId = getDouyinVideoId(url);
    if (dyId) return buildMeta('douyin', dyId, url, input.previewImage);

    // Generic video link
    const genericId = detectGenericVideoLink(url);
    if (genericId) return buildMeta('generic', genericId, url, input.previewImage);
  }

  return null;
}
