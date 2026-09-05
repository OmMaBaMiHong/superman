/**
 * TrendRadar generic_webhook 渲染文本的容错解析。
 *
 * TrendRadar 的 payload_template 只支持 {title}/{content} 占位符，
 * 实际收到的是渲染后的 markdown 报告文本（可能分批多次推送），形如：
 *
 *   **【微博】**
 *   1. [某某热搜](https://s.weibo.com/...) **[1]** 📈
 *   2. 另一条热搜 [3 - 5]
 *
 * 解析策略是 best-effort：识别平台小节头（【xx】/加粗独行/## 头）与
 * 编号条目行（`1.` / `1、` / `[1]`），抽出 markdown 链接与排名区间。
 * 解析不出条目不报错——原始 payload 始终完整存进 payload_json，
 * 主链路（SQLite sync）会补齐结构化数据。
 */

export interface TrendRadarWebhookParsedItem {
  platform: string;
  title: string;
  url: string | null;
  rank: number | null;
}

export interface TrendRadarWebhookPayload {
  /** 报告类型（daily/current/增量等），来自 body.title。 */
  reportType: string;
  /** 渲染文本原文。 */
  content: string;
  /** 模板里可能带的 token 字段（generic_webhook 无法自定义 header 时的回落）。 */
  token: string | null;
  items: TrendRadarWebhookParsedItem[];
}

/** 平台小节头：【微博】、**【微博】**、## 微博、**微博**、📢 微博 等。 */
const PLATFORM_HEADER_PATTERNS = [
  /^[>\s*#]*【([^\]】]{1,30})】[*#\s]*$/,
  /^[>\s]*#{1,4}\s*\*{0,2}([\u4e00-\u9fa5A-Za-z0-9_-]{1,30})\*{0,2}\s*$/,
  /^[>\s]*\*{2}([\u4e00-\u9fa5A-Za-z0-9_-]{1,30})\*{2}\s*$/,
];

/** 条目行：`1. xxx`、`1、xxx`、`[1] xxx`，允许引用/斜体前缀；编号后需有分隔符或空白。 */
const ITEM_LINE_PATTERN = /^[>\s]*(?:\*\*\[?(\d{1,3})\]?\*\*|\[?(\d{1,3})\]?)(?:[.、)\]]\s*|\s+)(\S.*)$/;
/** 行内 markdown 链接：[标题](url)。 */
const MARKDOWN_LINK_PATTERN = /\[([^\]]{1,200})\]\((https?:\/\/[^)\s]{1,1000})\)/;
/** 行尾排名区间：[3]、[3 - 5]、**[1]**，可带趋势箭头（emoji 为代理对，需成对匹配）。 */
const TRAILING_RANK_PATTERN = /\*{0,2}\[(\d{1,3})(?:\s*-\s*\d{1,3})?\]\*{0,2}(?:\s*(?:📈|📉))?\s*$/;

/** 明显不是平台名的标题词（统计/说明区块头），避免误识别。 */
const NON_PLATFORM_HEADERS = new Set([
  '热点词汇统计',
  '热点新闻',
  '新增热点',
  '趋势分析',
  'RSS',
]);

function parsePlatformHeader(line: string): string | null {
  for (const pattern of PLATFORM_HEADER_PATTERNS) {
    const match = line.match(pattern);
    if (!match) continue;
    const name = (match[1] ?? '').trim();
    if (!name || NON_PLATFORM_HEADERS.has(name)) continue;
    // 含空格或标点的大概率是正文句子而非平台名
    if (/[\s，。,.!！?？:：]/.test(name)) continue;
    return name;
  }
  return null;
}

function parseItemLine(line: string, platform: string): TrendRadarWebhookParsedItem | null {
  const match = line.match(ITEM_LINE_PATTERN);
  if (!match) return null;

  const lineRank = Number(match[1] ?? match[2]);
  let rest = (match[3] ?? '').trim();
  if (!rest) return null;

  let url: string | null = null;
  const link = rest.match(MARKDOWN_LINK_PATTERN);
  if (link) {
    url = link[2];
    rest = `${rest.slice(0, link.index)}${link[1]}${rest.slice((link.index ?? 0) + link[0].length)}`.trim();
  }

  let rank: number | null = Number.isInteger(lineRank) && lineRank > 0 ? lineRank : null;
  const trailingRank = rest.match(TRAILING_RANK_PATTERN);
  if (trailingRank) {
    rank = Number(trailingRank[1]);
    rest = rest.slice(0, trailingRank.index).trim();
  }

  // 去掉残留的加粗标记与趋势箭头
  const title = rest.replace(/\*\*/g, '').replace(/📈|📉/g, '').trim();
  if (!title) return null;

  return { platform, title, url, rank };
}

/** 解析 webhook 请求体；body 不是对象/没有 content 时返回 null。 */
export function parseTrendRadarWebhookPayload(body: unknown): TrendRadarWebhookPayload | null {
  let reportType = '';
  let content = '';
  let token: string | null = null;

  if (typeof body === 'string') {
    content = body;
  } else if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.content === 'string') {
      content = record.content;
    } else if (typeof record.text === 'string') {
      // 某些网关会包一层 {text: ...}
      content = record.text;
    } else {
      return null;
    }
    if (typeof record.title === 'string') reportType = record.title;
    if (typeof record.token === 'string' && record.token.trim()) token = record.token.trim();
  } else {
    return null;
  }

  if (!content.trim()) return null;

  const items: TrendRadarWebhookParsedItem[] = [];
  let platform = 'unknown';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = parsePlatformHeader(line);
    if (header) {
      platform = header;
      continue;
    }

    const item = parseItemLine(line, platform);
    if (item) items.push(item);
  }

  return { reportType, content, token, items };
}
