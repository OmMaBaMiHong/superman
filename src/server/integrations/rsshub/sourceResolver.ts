import { getRssHubRoutePath, isRssHubUrl } from '@/lib/rsshub/url';
import { isSafeExternalUrl } from '@/server/integrations/rss/ssrfGuard';
import { fetchEmbeddedRssHubRoute } from './embeddedRssHubApp';

// 请求 RSS 源并解析 <title> 作为订阅名称
async function fetchRssHubFeedTitle(routePath: string): Promise<string | null> {
  try {
    const response = await fetchEmbeddedRssHubRoute(routePath);
    if (!response.ok) return null;

    const text = await response.text();
    // RSS 2.0 / Atom: 第一个 <title> 是频道/订阅源名称
    const match = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

interface RadarRule {
  title?: string;
  source?: string[];
  target?: string;
}

type RadarRules = Record<string, unknown>;

export interface RssHubSourceResolveResult {
  resolved: boolean;
  inputUrl: string;
  finalUrl?: string;
  rssHubUrl?: string;
  routePath?: string;
  title?: string;
  sourceDomain?: string;
  message?: string;
}

interface ResolveDependencies {
  fetchFinalUrl?: (url: string) => Promise<string>;
  fetchRadarRules?: (domain: string) => Promise<unknown>;
  isSafeUrl?: (url: string) => Promise<boolean>;
}

const resolveSafetyOptions = { allowUnresolvedHostname: true } as const;

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function createResolvedResult(inputUrl: string, routePath: string, meta: {
  finalUrl?: string;
  title?: string;
  sourceDomain?: string;
} = {}): RssHubSourceResolveResult {
  return {
    resolved: true,
    inputUrl,
    finalUrl: meta.finalUrl,
    rssHubUrl: `rsshub://${routePath.replace(/^\//, '')}`,
    routePath,
    title: meta.title,
    sourceDomain: meta.sourceDomain,
  };
}

async function defaultFetchFinalUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'FeedFuse RSSHub Resolver',
    },
  });
  await response.body?.cancel().catch(() => undefined);
  return response.url || url;
}

async function defaultFetchRadarRules(domain: string): Promise<unknown> {
  const response = await fetchEmbeddedRssHubRoute(`/api/radar/rules/${encodeURIComponent(domain)}`);
  if (!response.ok) return null;

  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getRegistrableDomainFallback(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  return labels.slice(-2).join('.');
}

function getRadarDomainCandidates(hostname: string): string[] {
  const normalized = hostname.toLowerCase();
  const fallback = getRegistrableDomainFallback(normalized);
  return Array.from(new Set([normalized, fallback].filter(Boolean)));
}

function getSubdomain(hostname: string, domain: string): string {
  if (hostname === domain) return '.';
  if (!hostname.endsWith(`.${domain}`)) return '.';
  return hostname.slice(0, -domain.length - 1) || '.';
}

function isRadarRules(value: unknown): value is RadarRules {
  return typeof value === 'object' && value !== null;
}

function readRadarRuleGroups(rules: RadarRules, subdomain: string): RadarRule[] {
  const groups: RadarRule[] = [];

  for (const key of [subdomain, '.']) {
    const value = rules[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === 'object' && item !== null) {
        groups.push(item as RadarRule);
      }
    }
  }

  return groups;
}

function splitUrlPattern(value: string): string[] {
  return value.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean);
}

function matchSourcePattern(pattern: string, url: URL): Record<string, string> | null {
  const urlValue = pattern.includes('?') || pattern.includes('#')
    ? `${url.pathname}${url.search}${url.hash}`
    : url.pathname;
  const patternSegments = splitUrlPattern(pattern);
  const urlSegments = splitUrlPattern(urlValue);

  if (patternSegments.length !== urlSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const urlSegment = urlSegments[index];
    if (!patternSegment || !urlSegment) return null;

    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(urlSegment);
      continue;
    }

    if (patternSegment !== urlSegment) return null;
  }

  return params;
}

function applyTargetParams(target: string, params: Record<string, string>): string {
  return target.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
    const value = params[key] ?? '';
    return encodeURIComponent(value).replaceAll('%40', '@');
  });
}

function isDouyinHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'douyin.com' ||
    normalized.endsWith('.douyin.com') ||
    normalized === 'iesdouyin.com' ||
    normalized.endsWith('.iesdouyin.com')
  );
}

function resolveDouyinShareUrl(inputUrl: string, finalUrl: URL): RssHubSourceResolveResult | null {
  const hostname = finalUrl.hostname.toLowerCase();
  if (!isDouyinHostname(hostname)) {
    return null;
  }

  const segments = splitUrlPattern(finalUrl.pathname);
  const sourceDomain = getRegistrableDomainFallback(hostname);

  // 1) /share/user/{uid} —— 手机端用户分享页（短链最常见落地）
  const shareUserIndex = segments.findIndex(
    (segment, index) => segment === 'share' && segments[index + 1] === 'user',
  );
  if (shareUserIndex >= 0 && segments[shareUserIndex + 2]) {
    const uid = decodeURIComponent(segments[shareUserIndex + 2]);
    return createResolvedResult(inputUrl, `/douyin/user/${encodeURIComponent(uid)}`, {
      finalUrl: finalUrl.toString(),
      title: '抖音博主',
      sourceDomain,
    });
  }

  // 2) /user/{uid} —— 桌面端用户主页
  const userIndex = segments.findIndex((segment) => segment === 'user');
  if (userIndex >= 0 && segments[userIndex + 1]) {
    const uid = decodeURIComponent(segments[userIndex + 1]);
    return createResolvedResult(inputUrl, `/douyin/user/${encodeURIComponent(uid)}`, {
      finalUrl: finalUrl.toString(),
      title: '抖音博主',
      sourceDomain,
    });
  }

  // 3) /share/video/{id} 或 /video/{id} —— 视频页，依赖 sec_uid 反推作者
  const shareVideoIndex = segments.findIndex(
    (segment, index) => segment === 'share' && segments[index + 1] === 'video',
  );
  const videoIndex = shareVideoIndex >= 0 ? shareVideoIndex : segments.indexOf('video');
  const videoId = videoIndex >= 0 ? segments[videoIndex + 1] : undefined;
  const secUid = finalUrl.searchParams.get('sec_uid');
  if (videoId) {
    if (secUid) {
      return createResolvedResult(inputUrl, `/douyin/user/${encodeURIComponent(secUid)}`, {
        finalUrl: finalUrl.toString(),
        title: '抖音博主',
        sourceDomain,
      });
    }
    // 视频页缺少 sec_uid 无法反推作者，引导用户改贴主页链接。
    return {
      resolved: false,
      inputUrl,
      finalUrl: finalUrl.toString(),
      sourceDomain,
      message: '这是一个抖音视频链接，缺少作者信息，无法生成订阅。请改用作者主页链接（douyin.com/user/…）。',
    };
  }

  // 4) 兜底：URL 上直接带 sec_uid 参数（如分享弹层场景）
  if (secUid) {
    return createResolvedResult(inputUrl, `/douyin/user/${encodeURIComponent(secUid)}`, {
      finalUrl: finalUrl.toString(),
      title: '抖音博主',
      sourceDomain,
    });
  }

  return null;
}

async function resolveByRadarRules(
  inputUrl: string,
  finalUrl: URL,
  fetchRadarRules: (domain: string) => Promise<unknown>,
): Promise<RssHubSourceResolveResult | null> {
  const hostname = finalUrl.hostname.toLowerCase();
  for (const domain of getRadarDomainCandidates(hostname)) {
    const rules = await fetchRadarRules(domain);
    if (!isRadarRules(rules)) continue;

    const ruleGroups = readRadarRuleGroups(rules, getSubdomain(hostname, domain));
    for (const rule of ruleGroups) {
      if (!rule.target || !Array.isArray(rule.source)) continue;

      for (const source of rule.source) {
        const params = matchSourcePattern(source, finalUrl);
        if (!params) continue;

        return createResolvedResult(inputUrl, applyTargetParams(rule.target, params), {
          finalUrl: finalUrl.toString(),
          title: rule.title,
          sourceDomain: domain,
        });
      }
    }
  }

  return null;
}

export async function resolveRssHubSourceUrl(
  value: string,
  deps: ResolveDependencies = {},
): Promise<RssHubSourceResolveResult> {
  const inputUrl = value.trim();
  if (!inputUrl) {
    return { resolved: false, inputUrl, message: '请输入要识别的链接。' };
  }

  if (isRssHubUrl(inputUrl)) {
    const routePath = getRssHubRoutePath(inputUrl);
    if (routePath) {
      const title = await fetchRssHubFeedTitle(routePath);
      return createResolvedResult(inputUrl, routePath, { title: title ?? undefined });
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return { resolved: false, inputUrl, message: '链接格式不正确。' };
  }

  if (!isHttpUrl(parsed)) {
    return { resolved: false, inputUrl, message: '仅支持 http、https 或 rsshub 链接。' };
  }

  const checkSafeUrl = deps.isSafeUrl ?? ((url: string) => isSafeExternalUrl(url, resolveSafetyOptions));
  if (!(await checkSafeUrl(inputUrl))) {
    return { resolved: false, inputUrl, message: '当前网络环境不允许访问该链接。' };
  }

  const finalUrlValue = await (deps.fetchFinalUrl ?? defaultFetchFinalUrl)(inputUrl);
  const finalUrl = new URL(finalUrlValue);
  if (!isHttpUrl(finalUrl) || !(await checkSafeUrl(finalUrl.toString()))) {
    return { resolved: false, inputUrl, finalUrl: finalUrl.toString(), message: '跳转后的链接不可访问。' };
  }

  const douyinResult = resolveDouyinShareUrl(inputUrl, finalUrl);
  if (douyinResult) return douyinResult;

  const radarResult = await resolveByRadarRules(
    inputUrl,
    finalUrl,
    deps.fetchRadarRules ?? defaultFetchRadarRules,
  );
  if (radarResult) return radarResult;

  return {
    resolved: false,
    inputUrl,
    finalUrl: finalUrl.toString(),
    sourceDomain: getRegistrableDomainFallback(finalUrl.hostname),
    message: '暂未找到匹配的 RSSHub 规则，可直接粘贴 RSS 或 rsshub:// 链接。',
  };
}
