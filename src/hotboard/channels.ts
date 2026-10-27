/**
 * 内置热榜渠道 —— 纯 TS 直采公开榜单 JSON 接口，零外部进程依赖。
 *
 * 这就是开源版的"写死的几个渠道"：每个渠道一个 endpoint + 一个解析函数，
 * 用户改这个文件（或后续做成配置）即可增删渠道。字段结构对齐
 * core/trendradar 的 TrendRadarUpsertItem（platform/title/url/rank/hotValue），
 * 采集结果直接喂 upsertTrendRadarItems 入库，看板/agent 工具零改动复用。
 *
 * 渠道遴选原则（吸收 TrendRadar/FactReach 经验）：只收无需鉴权、返回稳定
 * JSON 的公开榜单；带 UA 伪装；单渠道失败不影响其它渠道。
 */

export interface HotboardRawItem {
  title: string;
  url?: string | null;
  rank: number;
  hotValue?: string | null;
}

export interface HotboardChannel {
  /** 稳定 ID，入库 platform 字段 */
  id: string;
  /** 展示名，入库 platform_name */
  name: string;
  homeUrl: string;
  endpoint: string;
  headers?: Record<string, string>;
  /** 从 JSON 响应解析条目；抛错视为该渠道本轮失败，不拖累其它渠道。 */
  parse: (json: unknown) => HotboardRawItem[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 知乎热榜：data[].target.title；detail_text 形如 "2700万热度" */
const zhihu: HotboardChannel = {
  id: 'zhihu',
  name: '知乎热榜',
  homeUrl: 'https://www.zhihu.com/hot',
  endpoint: 'https://api.zhihu.com/topstory/hot-list?limit=50',
  headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  parse(json) {
    return asArray(asRecord(json).data).map((raw, index) => {
      const entry = asRecord(raw);
      const target = asRecord(entry.target);
      const apiUrl = str(target.url);
      return {
        title: str(target.title).replace(/^「/u, '「'),
        url: apiUrl ? apiUrl.replace('api.zhihu.com', 'www.zhihu.com') : null,
        rank: index + 1,
        hotValue: str(entry.detail_text) || null,
      };
    });
  },
};

/** 微博热搜：data.realtime[].word，num 为热度值 */
const weibo: HotboardChannel = {
  id: 'weibo',
  name: '微博热搜',
  homeUrl: 'https://s.weibo.com/top/summary',
  endpoint: 'https://weibo.com/ajax/side/hotSearch',
  headers: {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    referer: 'https://weibo.com/',
  },
  parse(json) {
    const realtime = asArray(asRecord(asRecord(json).data).realtime);
    return realtime.map((raw, index) => {
      const entry = asRecord(raw);
      const word = str(entry.word);
      return {
        title: word,
        url: str(entry.scheme) || `https://s.weibo.com/weibo?q=${encodeURIComponent(word)}`,
        rank: index + 1,
        hotValue: num(entry.num) !== null ? String(num(entry.num)) : null,
      };
    });
  },
};

/** 百度热搜：data.cards[].content[].word */
const baidu: HotboardChannel = {
  id: 'baidu',
  name: '百度热搜',
  homeUrl: 'https://top.baidu.com/board?tab=realtime',
  endpoint: 'https://top.baidu.com/api/board?platform=wise&tab=realtime',
  headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
  parse(json) {
    const cards = asArray(asRecord(json).data ? asRecord(asRecord(json).data).cards : []);
    const items: HotboardRawItem[] = [];
    const collect = (entry: unknown): void => {
      const record = asRecord(entry);
      // 接口出现过两种形态：content[] 直接是条目（word），或条目分组再嵌一层 content[]
      if (str(record.word)) {
        items.push({
          title: str(record.word),
          url: str(record.url) || `https://www.baidu.com/s?wd=${encodeURIComponent(str(record.word))}`,
          rank: items.length + 1,
          hotValue: num(record.hotScore) !== null ? String(num(record.hotScore)) : null,
        });
        return;
      }
      for (const child of asArray(record.content)) collect(child);
    };
    for (const card of cards) {
      for (const group of asArray(asRecord(card).content)) collect(group);
    }
    return items.slice(0, 50);
  },
};

/** 头条热榜：data[].Title / HotValue */
const toutiao: HotboardChannel = {
  id: 'toutiao',
  name: '头条热榜',
  homeUrl: 'https://www.toutiao.com/',
  endpoint: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
  headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  parse(json) {
    return asArray(asRecord(json).data).map((raw, index) => {
      const entry = asRecord(raw);
      const title = str(entry.Title);
      return {
        title,
        url: str(entry.Url) || `https://so.toutiao.com/search?keyword=${encodeURIComponent(title)}`,
        rank: index + 1,
        hotValue: num(entry.HotValue) !== null ? String(num(entry.HotValue)) : null,
      };
    });
  },
};

/** 抖音热点：word_list[].word / hot_value */
const douyin: HotboardChannel = {
  id: 'douyin',
  name: '抖音热点',
  homeUrl: 'https://www.douyin.com/hot',
  endpoint: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/',
  headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
  parse(json) {
    return asArray(asRecord(json).word_list).map((raw, index) => {
      const entry = asRecord(raw);
      const word = str(entry.word);
      return {
        title: word,
        url: `https://www.douyin.com/search/${encodeURIComponent(word)}`,
        rank: index + 1,
        hotValue: num(entry.hot_value) !== null ? String(num(entry.hot_value)) : null,
      };
    });
  },
};

/** 内置渠道清单 —— 顺序即采集顺序；增删渠道改这里即可。 */
export const BUILTIN_CHANNELS: readonly HotboardChannel[] = [zhihu, weibo, baidu, toutiao, douyin];

/** 允许通过环境变量追加渠道配置文件的路径（JSON 数组，同 HotboardChannel 形状，parse 内置不支持）。 */
export function resolveChannels(env: NodeJS.ProcessEnv = process.env): HotboardChannel[] {
  const extra = env.HOTBOARD_EXTRA_CHANNELS_JSON?.trim();
  if (!extra) return [...BUILTIN_CHANNELS];
  try {
    const parsed = JSON.parse(extra) as Array<Record<string, unknown>>;
    return [
      ...BUILTIN_CHANNELS,
      ...parsed.map((raw) => ({
        id: str(raw.id),
        name: str(raw.name) || str(raw.id),
        homeUrl: str(raw.homeUrl),
        endpoint: str(raw.endpoint),
        headers: (raw.headers as Record<string, string> | undefined) ?? undefined,
        parse(json: unknown) {
          return asArray(asRecord(json).items).map((item, index) => {
            const entry = asRecord(item);
            return {
              title: str(entry.title),
              url: str(entry.url) || null,
              rank: num(entry.rank) ?? index + 1,
              hotValue: str(entry.hotValue) || null,
            };
          });
        },
      })),
    ].filter((channel) => channel.id && channel.endpoint);
  } catch {
    return [...BUILTIN_CHANNELS];
  }
}
