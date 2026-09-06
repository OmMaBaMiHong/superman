/**
 * Superman 独立爬虫服务的 TS 调用端（P3a）。
 *
 * 服务：integrations/crawler-service（FastAPI，默认 127.0.0.1:5510）。
 * 鉴权：配置 CRAWLER_SERVICE_KEY 时带 X-Caller-Key 头；两边都留空则不鉴权（本机开发）。
 * 失败语义：网络不可达 / 非零 code 统一抛 CrawlerServiceError，只透出 code + error 摘要，
 * 不透传上游响应体（TikHub 402 响应体会回显 API key，绝不能进日志/前端）。
 */
export interface CrawlerComment {
  cid: string;
  text: string;
  user: string;
  likes: number;
  /** 原始时间字符串（抖音/B站秒级、小红书毫秒级 unix），无法解析为空串。 */
  time: string;
  replyCount: number;
  platform: string;
  postId: string;
  ipLocation: string | null;
}

export interface CrawlerPostStats {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  favorites: number | null;
  coins: number | null;
  platform: string;
  postId: string;
  /** 平台标题/文案（B站视频标题、抖音标题或文案、小红书笔记题）。 */
  title: string | null;
}

export interface CrawlerCommentsResult {
  items: CrawlerComment[];
  total: number | null;
  provider: string | null;
}

export class CrawlerServiceError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'CrawlerServiceError';
    this.code = code;
  }
}

/** 最小 fetch 结构类型：便于测试注入，不耦合全局 fetch 的完整签名。 */
export type CrawlerFetchImpl = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface CrawlerClientDeps {
  fetchImpl?: CrawlerFetchImpl;
  baseUrl?: string;
  callerKey?: string | null;
}

export function resolveCrawlerBaseUrl(): string {
  return (process.env.CRAWLER_SERVICE_URL || 'http://127.0.0.1:5510').replace(/\/+$/, '');
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapComment(raw: unknown): CrawlerComment {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    cid: String(c.cid ?? ''),
    text: String(c.text ?? ''),
    user: String(c.user ?? ''),
    likes: toNullableNumber(c.likes) ?? 0,
    time: String(c.time ?? ''),
    replyCount: toNullableNumber(c.reply_count) ?? 0,
    platform: String(c.platform ?? ''),
    postId: String(c.post_id ?? ''),
    ipLocation: c.ip_location === null || c.ip_location === undefined ? null : String(c.ip_location),
  };
}

function mapStats(raw: unknown): CrawlerPostStats {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    views: toNullableNumber(s.views),
    likes: toNullableNumber(s.likes),
    comments: toNullableNumber(s.comments),
    shares: toNullableNumber(s.shares),
    favorites: toNullableNumber(s.favorites),
    coins: toNullableNumber(s.coins),
    platform: String(s.platform ?? ''),
    postId: String(s.post_id ?? ''),
    title: s.title === null || s.title === undefined || s.title === '' ? null : String(s.title),
  };
}

export interface CrawlerClient {
  fetchComments(input: { platform: string; postId: string; max?: number }): Promise<CrawlerCommentsResult>;
  fetchPostStats(input: { platform: string; postId: string }): Promise<CrawlerPostStats>;
}

export function createCrawlerClient(deps: CrawlerClientDeps = {}): CrawlerClient {
  const baseUrl = normalizeBaseUrl(deps.baseUrl ?? resolveCrawlerBaseUrl());
  const callerKey = (deps.callerKey !== undefined ? deps.callerKey : process.env.CRAWLER_SERVICE_KEY || '') || null;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as CrawlerFetchImpl);

  async function get(
    path: string,
    query: Record<string, string>,
  ): Promise<{ data: unknown; provider: string | null }> {
    const url = `${baseUrl}${path}?${new URLSearchParams(query).toString()}`;
    const headers: Record<string, string> = {};
    if (callerKey) headers['X-Caller-Key'] = callerKey;
    let res: { status: number; json: () => Promise<unknown> };
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new CrawlerServiceError(
        0,
        `爬虫服务不可达（${baseUrl}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    let envelope: { code?: unknown; data?: unknown; provider?: unknown; error?: unknown };
    try {
      envelope = (await res.json()) as typeof envelope;
    } catch {
      throw new CrawlerServiceError(res.status, `爬虫服务返回非 JSON（HTTP ${res.status}）`);
    }
    if (envelope.code !== 0) {
      throw new CrawlerServiceError(
        res.status,
        `爬虫服务错误（code=${String(envelope.code)}）：${String(envelope.error ?? '未知错误').slice(0, 200)}`,
      );
    }
    return {
      data: envelope.data,
      provider: typeof envelope.provider === 'string' ? envelope.provider : null,
    };
  }

  return {
    async fetchComments(input) {
      const query: Record<string, string> = {
        platform: input.platform,
        post_id: input.postId,
      };
      if (input.max != null) query.max = String(Math.max(1, Math.min(100, Math.round(input.max))));
      const { data, provider } = await get('/v1/comments', query);
      const raw = (data ?? {}) as { items?: unknown; total?: unknown };
      const items = Array.isArray(raw.items) ? raw.items.map(mapComment) : [];
      return { items, total: toNullableNumber(raw.total), provider };
    },

    async fetchPostStats(input) {
      const { data } = await get('/v1/post-stats', {
        platform: input.platform,
        post_id: input.postId,
      });
      return mapStats(data);
    },
  };
}
