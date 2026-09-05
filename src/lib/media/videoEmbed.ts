/**
 * 视频嵌入解析（纯函数，Next 版与 H5 共用）。
 * B站走官方 iframe embed（player.bilibili.com/player.html?bvid=…）；
 * 抖音 embed 限制多，给封面 + 外链（由组件渲染）。
 */

const BILIBILI_BVID_RE = /(?:bilibili\.com\/video\/|b23\.tv\/)(BV[0-9A-Za-z]+)/i;
const DOUYIN_RE = /(?:douyin\.com|iesdouyin\.com)/i;

/** 从 URL 解析 B站 bvid（不支持的路径返回 null）。 */
export function extractBilibiliBvid(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = BILIBILI_BVID_RE.exec(url);
  return match ? match[1] : null;
}

export function isDouyinUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && DOUYIN_RE.test(url);
}

export type VideoEmbedInfo =
  | { kind: 'bilibili'; bvid: string; embedUrl: string }
  | { kind: 'douyin'; url: string }
  | null;

/** 由来源链接推导嵌入方式；非视频平台返回 null。 */
export function resolveVideoEmbed(sourceUrl: string | null | undefined): VideoEmbedInfo {
  const bvid = extractBilibiliBvid(sourceUrl);
  if (bvid) {
    return {
      kind: 'bilibili',
      bvid,
      embedUrl: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&autoplay=0`,
    };
  }
  if (isDouyinUrl(sourceUrl)) {
    return { kind: 'douyin', url: sourceUrl as string };
  }
  return null;
}
