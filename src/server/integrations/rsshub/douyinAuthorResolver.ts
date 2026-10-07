/**
 * 抖音作品 → 元数据解析器。
 *
 * 抖音作品分享链接（v.douyin.com/xxx → /share/video/<id>）的作者与作品信息由前端
 * XHR 加载，且受 WAF 防护，纯 HTTP 抓不到。这里用 Playwright 打开
 * https://www.douyin.com/video/<id>，拦截 aweme/v1/web/aweme/detail 响应，
 * 从 JSON 中提取作者 sec_uid + nickname + 作品文案 + 封面。
 *
 * 用途：
 *   - 关注博主：生成 rsshub://douyin/user/<sec_uid>
 *   - 收藏作品：标题/封面写入 clip
 *
 * 耗时 5-10 秒。
 */

import { loadPatchright, type PageLike } from './browserLoader';

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DouyinVideoResult {
  success: boolean;
  /** 作者 sec_uid（用于订阅 rsshub://douyin/user/<sec_uid>）。 */
  secUid?: string;
  /** 作者昵称。 */
  nickname?: string;
  /** 作品文案（作为收藏标题）。 */
  desc?: string;
  /** 作品封面图 URL。 */
  cover?: string;
  /** 作品 ID。 */
  awemeId?: string;
  error?: string;
}

/** 从文本中提取 sec_uid（以 MS4wLjABAAAA 开头）。 */
export function extractSecUid(text: string): string | null {
  const m = text.match(/(MS4wLjABAAAA[A-Za-z0-9\-_]{10,})/);
  return m?.[1] ?? null;
}

/** 从 URL 中提取作品 ID。 */
export function extractVideoId(url: string): string | null {
  const m = url.match(/\/(?:video|share\/video)\/(\d{10,})/);
  return m?.[1] ?? null;
}

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/**
 * 从分享链接解析出作品 ID：
 *   1. 链接本身是 /video/<id> → 直接取
 *   2. v.douyin.com 短链 → 跟随重定向，从落地页取
 * 非作品链接返回 null。
 */
export async function resolveVideoIdFromShareUrl(url: string): Promise<string | null> {
  const direct = extractVideoId(url);
  if (direct) return direct;
  if (!/v\.douyin\.com\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': MOBILE_UA, Accept: 'text/html' },
    });
    return extractVideoId(res.url);
  } catch {
    return null;
  }
}

interface ResponseLike {
  url: () => string;
  text: () => Promise<string>;
}

/** 从作品详情 XHR 响应里解析作者与作品元数据。 */
async function handleDetailResponse(arg: unknown, captured: DouyinVideoResult): Promise<void> {
  const response = arg as ResponseLike;
  try {
    const url = typeof response.url === 'function' ? response.url() : '';
    if (!/aweme\/detail/i.test(url)) return;
    const text = await response.text();

    try {
      const json = JSON.parse(text) as {
        aweme_detail?: {
          aweme_id?: string;
          desc?: string;
          author?: { nickname?: string; sec_uid?: string };
          video?: { cover?: { url_list?: string[] }; origin_cover?: { url_list?: string[] } };
        };
      };
      const detail = json?.aweme_detail;
      if (detail) {
        captured.awemeId = detail.aweme_id ?? captured.awemeId;
        captured.desc = detail.desc ?? captured.desc;
        captured.nickname = detail.author?.nickname ?? captured.nickname;
        captured.secUid = detail.author?.sec_uid ?? captured.secUid;
        const cover = detail.video?.cover?.url_list ?? detail.video?.origin_cover?.url_list;
        if (cover?.length) captured.cover = cover[cover.length - 1] ?? captured.cover;
        return;
      }
    } catch {
      // JSON 解析失败，退回正则
    }

    // 正则兜底
    if (!captured.secUid) {
      const m = text.match(/"sec_uid"\s*:\s*"([^"]+)"/i);
      if (m?.[1]) captured.secUid = m[1];
    }
    if (!captured.nickname) {
      const nick = text.match(/"nickname"\s*:\s*"([^"]+)"/i);
      if (nick?.[1]) captured.nickname = nick[1];
    }
  } catch {
    // 忽略单个响应错误
  }
}

/** 用浏览器打开作品页，拦截 XHR 提取作者 + 作品元数据。 */
export async function resolveDouyinVideo(videoId: string): Promise<DouyinVideoResult> {
  let browser: { close: () => Promise<void> } | null = null;
  let context: { close: () => Promise<void> } | null = null;

  try {
    const { chromium } = await loadPatchright();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const ctx = await (browser as unknown as {
      newContext: (o?: Record<string, unknown>) => Promise<{ newPage: () => Promise<PageLike>; close: () => Promise<void> }>;
    }).newContext({ userAgent: DESKTOP_UA });
    context = ctx;
    const page = await ctx.newPage();

    const captured: DouyinVideoResult = { success: false };
    page.on('response', (arg: unknown) => {
      void handleDetailResponse(arg, captured);
    });

    await page.goto(`https://www.douyin.com/video/${videoId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // 轮询等待 XHR 返回（最多 15s）
    const deadline = Date.now() + 15000;
    while (!captured.secUid && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    // 兜底：从渲染后的 HTML 提取 sec_uid
    if (!captured.secUid) {
      const html = await page.content();
      const secUid = extractSecUid(html);
      if (secUid) captured.secUid = secUid;
    }

    if (captured.secUid) {
      return { ...captured, success: true, awemeId: captured.awemeId ?? videoId };
    }
    return { success: false, awemeId: videoId, error: '浏览器未能获取作品信息（可能被 WAF 拦截）' };
  } catch (err) {
    return {
      success: false,
      awemeId: videoId,
      error: err instanceof Error ? err.message : '浏览器解析失败',
    };
  } finally {
    try {
      await context?.close();
    } catch {
      // 忽略
    }
    try {
      await browser?.close();
    } catch {
      // 忽略
    }
  }
}

/** 兼容：仅需作者信息时调用（sourceResolver 用）。 */
export async function resolveDouyinVideoAuthor(
  videoId: string,
): Promise<{ success: boolean; secUid?: string; nickname?: string; error?: string }> {
  const result = await resolveDouyinVideo(videoId);
  return {
    success: result.success,
    secUid: result.secUid,
    nickname: result.nickname,
    error: result.error,
  };
}
