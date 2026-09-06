/**
 * 平台表现数据适配层。
 *
 * MetricsProvider 接口：submit 一帖 URL，拿回标准化指标。
 *   - bilibili/douyin/xhs：经独立爬虫服务（P3a crawler-service，TikHub/B站直连下沉）。
 *     bilibili 在服务不可用时回落直连公开 API，保住 P2d 快照与登记标题补全。
 *   - wechat/other：stub（返回 null + reason），等 P2e 授权中心接 Cookie 后补实现。
 */
import { fetchExternalJson } from '@/server/infra/http/externalHttpClient';
import {
  createCrawlerClient,
  CrawlerServiceError,
  type CrawlerClient,
  type CrawlerPostStats,
} from '@/core/crawlerClient';
import { extractBvid, type PublishPlatform } from '@/core/publish-tracking/platform';

export interface PostMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  favorites: number | null;
  coins: number | null;
  followersDelta: number | null;
  rawJson: Record<string, unknown>;
}

export interface MetricsFetchOk {
  ok: true;
  metrics: PostMetrics;
  /** B站登记时自动补全标题用。 */
  title?: string;
}

export interface MetricsFetchErr {
  ok: false;
  reason: string;
}

export type MetricsFetchResult = MetricsFetchOk | MetricsFetchErr;

export interface MetricsProvider {
  platform: PublishPlatform;
  fetchMetrics(postUrl: string): Promise<MetricsFetchResult>;
}

const BILIBILI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface BilibiliViewResponse {
  code?: number;
  message?: string;
  data?: {
    title?: string;
    stat?: {
      view?: number;
      like?: number;
      reply?: number;
      share?: number;
      favorite?: number;
      coin?: number;
    };
  };
}

/** 测试注入点：替换底层 HTTP 调用。 */
export type BilibiliJsonFetcher = (url: string) => Promise<{ status: number; json: BilibiliViewResponse | null }>;

async function defaultBilibiliFetch(url: string) {
  const result = await fetchExternalJson<BilibiliViewResponse>(url, {
    timeoutMs: 10_000,
    userAgent: BILIBILI_UA,
    allowedHosts: ['api.bilibili.com'],
    logging: { source: 'core/publish-tracking/bilibili', requestLabel: 'Bilibili view API' },
  });
  return { status: result.status, json: result.json };
}

function toSafeInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function createBilibiliProvider(fetchJson: BilibiliJsonFetcher = defaultBilibiliFetch): MetricsProvider {
  return {
    platform: 'bilibili',
    async fetchMetrics(postUrl: string): Promise<MetricsFetchResult> {
      const bvid = extractBvid(postUrl);
      if (!bvid) {
        return { ok: false, reason: '无法从 URL 解析 BV 号' };
      }
      const { status, json } = await fetchJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      );
      if (status < 200 || status >= 300 || !json) {
        return { ok: false, reason: `B站 API HTTP ${status}` };
      }
      if (json.code !== 0 || !json.data?.stat) {
        return { ok: false, reason: `B站 API 返回错误：${json.message ?? `code=${json.code}`}` };
      }
      const stat = json.data.stat;
      return {
        ok: true,
        title: typeof json.data.title === 'string' ? json.data.title : undefined,
        metrics: {
          views: toSafeInt(stat.view),
          likes: toSafeInt(stat.like),
          comments: toSafeInt(stat.reply),
          shares: toSafeInt(stat.share),
          favorites: toSafeInt(stat.favorite),
          coins: toSafeInt(stat.coin),
          followersDelta: null,
          rawJson: { bvid, stat },
        },
      };
    },
  };
}

function createStubProvider(platform: PublishPlatform): MetricsProvider {
  return {
    platform,
    async fetchMetrics(): Promise<MetricsFetchResult> {
      return { ok: false, reason: '该平台需授权中心支持（P2e），暂未开放抓取' };
    },
  };
}

const stubProviders = new Map<PublishPlatform, MetricsProvider>();

export interface CrawlerMetricsDeps {
  client?: CrawlerClient;
  /** B站服务失败时的直连兜底（服务没起时保住 P2d 快照与登记标题补全）。 */
  bilibiliFallback?: MetricsProvider;
}

function statsToPostMetrics(stats: CrawlerPostStats): PostMetrics {
  return {
    views: stats.views,
    likes: stats.likes,
    comments: stats.comments,
    shares: stats.shares,
    favorites: stats.favorites,
    coins: stats.coins,
    followersDelta: null,
    rawJson: { provider: 'crawler-service', crawlerPostId: stats.postId },
  };
}

/** 经 crawler-service 抓表现数据（douyin/xhs 唯一通路；bilibili 失败回落直连）。 */
export function createCrawlerServiceMetricsProvider(
  platform: 'bilibili' | 'douyin' | 'xhs',
  deps?: CrawlerMetricsDeps,
): MetricsProvider {
  const client = deps?.client ?? createCrawlerClient();
  return {
    platform,
    async fetchMetrics(postUrl: string): Promise<MetricsFetchResult> {
      try {
        const stats = await client.fetchPostStats({ platform, postId: postUrl });
        return { ok: true, title: stats.title ?? undefined, metrics: statsToPostMetrics(stats) };
      } catch (err) {
        const reason = err instanceof CrawlerServiceError
          ? `爬虫服务：${err.message}`
          : err instanceof Error ? err.message : String(err);
        const fallback = deps?.bilibiliFallback;
        if (platform === 'bilibili' && fallback) return fallback.fetchMetrics(postUrl);
        return { ok: false, reason };
      }
    },
  };
}

/** 按平台取 provider；crawler 服务覆盖 bilibili/douyin/xhs，其余返回 stub（接口语义完整）。 */
export function getMetricsProvider(
  platform: PublishPlatform,
  crawlerDeps?: CrawlerMetricsDeps,
): MetricsProvider {
  if (platform === 'bilibili' || platform === 'douyin' || platform === 'xhs') {
    return createCrawlerServiceMetricsProvider(platform, {
      bilibiliFallback: platform === 'bilibili' ? createBilibiliProvider() : undefined,
      ...crawlerDeps,
    });
  }
  let stub = stubProviders.get(platform);
  if (!stub) {
    stub = createStubProvider(platform);
    stubProviders.set(platform, stub);
  }
  return stub;
}
