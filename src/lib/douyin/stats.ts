/**
 * 抖音视频统计解析（共享工具）
 *
 * RSSHub 的 douyin/user 路由会在每条作品的 description 里注入一个隐藏 div：
 *   <div data-douyin-stats="aweme_id=...&create_time=...&duration=...&play_count=...&digg_count=...&comment_count=...&share_count=...&collect_count=..." style="display:none"></div>
 * 该属性经 sanitize-html 清洗后保留，落库到 articles.content_html。
 * 本文提供纯函数，供服务端（工作台聚合）与客户端（详情页仪表盘）复用。
 */

export interface DouyinVideoStats {
  awemeId: string;
  /** 发布时间（秒） */
  createTime: number;
  /** 时长（毫秒） */
  duration: number;
  stats: {
    plays: number;
    likes: number;
    comments: number;
    shares: number;
    collects: number;
  };
}

/** 从 content_html 中提取 data-douyin-stats 属性值 */
export function extractDouyinStatsTag(html: string): string | null {
  const m = html.match(/<div\s+data-douyin-stats="([^"]+)"/);
  return m?.[1] ?? null;
}

/** 解析 data-douyin-stats 属性值中的键值对（HTML entity 编码的 &amp; → &） */
export function parseDouyinStatsTag(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  // content_html 中 & 被编码为 &amp;，先还原再切分
  const decoded = tag.replace(/&amp;/g, '&');
  for (const pair of decoded.split('&')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx));
    const val = decodeURIComponent(pair.slice(eqIdx + 1));
    result[key] = val;
  }
  return result;
}

/** 从 content_html 解析出完整抖音视频统计；无标记返回 null */
export function parseDouyinStatsFromHtml(html: string): DouyinVideoStats | null {
  const tag = extractDouyinStatsTag(html);
  if (!tag) return null;

  const raw = parseDouyinStatsTag(tag);
  const awemeId = raw.aweme_id ?? '';
  if (!awemeId) return null;

  const durationSec = Number(raw.duration) || 0;

  return {
    awemeId,
    createTime: Number(raw.create_time) || 0,
    duration: Math.round(durationSec * 1000), // 秒 → 毫秒
    stats: {
      plays: Number(raw.play_count) || 0,
      likes: Number(raw.digg_count) || 0,
      comments: Number(raw.comment_count) || 0,
      shares: Number(raw.share_count) || 0,
      collects: Number(raw.collect_count) || 0,
    },
  };
}
