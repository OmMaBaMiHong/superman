/**
 * 收藏媒体的 URL 兼容层。
 *
 * 1) 历史数据里收藏图片/视频存的是 `/s/app/media/...`（早期把媒体挂在了应用静态目录下），
 *    宿主现在只伺服 `/s/api/media/...`，旧前缀在 iframe 里会 404（列表里就成了破图）。
 * 2) `<img>`/`<video>` 带不了 Authorization 头，宿主对媒体路由额外接受
 *    `?access_token=` 会话令牌（见 host/api.ts 的 MEDIA_TOKEN_ROUTES），
 *    所以渲染前统一补上令牌。
 */
import { readSessionToken } from '@/lib/sessionToken';

const LEGACY_PREFIX = '/s/app/media/';
const CURRENT_PREFIX = '/s/api/media/';

function withAccessToken(url: string): string {
  const token = readSessionToken();
  if (!token || !url.startsWith(CURRENT_PREFIX) || url.includes('access_token=')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
}

export function mediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  const normalized = url.startsWith(LEGACY_PREFIX) ? `${CURRENT_PREFIX}${url.slice(LEGACY_PREFIX.length)}` : url;
  return withAccessToken(normalized);
}

/** 富文本 HTML 里的媒体地址：旧前缀归一化 + 补会话令牌（收藏正文快照 <img src=…>）。 */
export function normalizeMediaHtml(html: string): string {
  const normalized = html.split(LEGACY_PREFIX).join(CURRENT_PREFIX);
  return normalized.replace(/\/s\/api\/media\/[^"'\s)]+/g, (match) => withAccessToken(match));
}
