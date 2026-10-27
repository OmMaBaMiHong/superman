/**
 * 热榜采集器 —— 并发抓取内置渠道，产出 TrendRadarUpsertItem[]。
 *
 * 设计约束：
 * - 单渠道失败被隔离（allSettled），产出 per-channel 结果供日志/前端展示；
 * - 10s 超时，防单点挂死拖垮整轮同步；
 * - 输出直接对齐 core/trendradar 的 upsert 契约，替换掉旧的
 *   「spawn TrendRadar Python 进程 + 读 SQLite」外采链路。
 */
import { resolveChannels, type HotboardChannel, type HotboardRawItem } from './channels.js';

export interface CollectorChannelResult {
  channelId: string;
  channelName: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface CollectorResult {
  items: Array<{
    platform: string;
    platformName: string;
    title: string;
    url?: string | null;
    rank?: number | null;
    hotValue?: string | null;
  }>;
  channels: CollectorChannelResult[];
}

const FETCH_TIMEOUT_MS = 10_000;
const MIN_TITLE_LENGTH = 2;
const MAX_ITEMS_PER_CHANNEL = 50;

async function fetchChannel(channel: HotboardChannel): Promise<HotboardRawItem[]> {
  const response = await fetch(channel.endpoint, {
    headers: {
      accept: 'application/json, text/plain, */*',
      ...(channel.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  const items = channel.parse(json).filter((item) => item.title.length >= MIN_TITLE_LENGTH);
  return items.slice(0, MAX_ITEMS_PER_CHANNEL);
}

export async function collectHotboard(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { platforms?: string[] },
): Promise<CollectorResult> {
  // 订阅制：用户勾选的平台白名单（空数组 = 未勾选任何平台 → 不采集）
  const allowed = opts?.platforms;
  const channels = resolveChannels(env).filter(
    (channel) => !allowed || allowed.length === 0 || allowed.includes(channel.id),
  );
  const settled = await Promise.allSettled(
    channels.map(async (channel) => ({ channel, items: await fetchChannel(channel) })),
  );

  const items: CollectorResult['items'] = [];
  const channelResults: CollectorChannelResult[] = [];

  settled.forEach((outcome, index) => {
    const channel = channels[index];
    if (!channel) return;
    if (outcome.status === 'fulfilled') {
      channelResults.push({
        channelId: channel.id,
        channelName: channel.name,
        ok: true,
        count: outcome.value.items.length,
      });
      for (const item of outcome.value.items) {
        items.push({
          platform: channel.id,
          platformName: channel.name,
          title: item.title,
          url: item.url ?? null,
          rank: item.rank,
          hotValue: item.hotValue ?? null,
        });
      }
    } else {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      channelResults.push({
        channelId: channel.id,
        channelName: channel.name,
        ok: false,
        count: 0,
        error: reason,
      });
    }
  });

  return { items, channels: channelResults };
}
