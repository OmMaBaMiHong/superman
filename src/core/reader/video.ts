import { JSDOM } from 'jsdom';
import { isSafeMediaUrl } from '@/server/integrations/media/mediaProxyGuard';
import { AppError, ForbiddenError } from '@/server/infra/http/errors';

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** RSSHub's older Douyin items store the play URL in an anchor instead of an enclosure. */
export function extractSubscriptionVideoUrl(input: {
  content: string | null;
  mediaAttachments: Array<{ url: string; mimeType: string }>;
}): string | null {
  for (const attachment of input.mediaAttachments) {
    if (attachment.mimeType.startsWith('video/') && httpUrl(attachment.url)) return httpUrl(attachment.url);
  }
  if (!input.content) return null;
  const fragment = JSDOM.fragment(input.content);
  for (const node of fragment.querySelectorAll('video[src], video source[src], a[href]')) {
    const value = httpUrl(node.getAttribute(node.tagName === 'A' ? 'href' : 'src'));
    if (!value) continue;
    if (node.tagName !== 'A') return value;
    const url = new URL(value);
    if (/\.(mp4|webm|m4v|mov)$/i.test(url.pathname) ||
      ((url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com')) && url.pathname === '/aweme/v1/play/')) return value;
  }
  return null;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Resolve redirects per request; keep the response streaming and preserve byte-range semantics. */
export async function fetchSubscriptionVideo(url: string, options: {
  sourceUrl?: string | null; range?: string; signal?: AbortSignal;
}): Promise<Response> {
  if (options.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(options.range)) {
    throw new AppError('不支持此视频分段请求', 'invalid_range', 416);
  }
  const source = httpUrl(options.sourceUrl);
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, 'accept-encoding': 'identity' };
  if (source) headers.referer = `${new URL(source).origin}/`;
  if (options.range) headers.range = options.range;
  let current = url;
  for (let hop = 0; hop <= 5; hop += 1) {
    if (!(await isSafeMediaUrl(current))) throw new ForbiddenError('视频地址不可访问');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(current, {
        headers, redirect: 'manual',
        signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      });
    } catch {
      throw new AppError('视频加载失败，请重试', 'video_unavailable', 502);
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    if (response.status === 416) return response;
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if ((response.status === 200 || response.status === 206) &&
      (mime.startsWith('video/') || mime === 'application/octet-stream') && response.body) return response;
    await response.body?.cancel();
    throw new AppError('视频地址暂不可用，请重试或刷新订阅源', 'video_unavailable', 502);
  }
  throw new AppError('视频跳转异常，请稍后重试', 'video_unavailable', 502);
}
