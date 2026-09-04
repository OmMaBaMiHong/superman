import { fetchRssXml } from '@/server/infra/http/externalHttpClient';
import { getRssHubRoutePath, isRssHubUrl } from '@/lib/rsshub/url';
import { fetchEmbeddedRssHubRoute } from '@/server/integrations/rsshub/embeddedRssHubApp';
import { injectRssHubCookieHeader } from '@/server/integrations/rsshub/rssHubCookieInjector';

export interface FetchFeedXmlResult {
  status: number;
  xml: string | null;
  etag: string | null;
  lastModified: string | null;
}

export interface FetchFeedXmlOptions {
  timeoutMs: number;
  userAgent: string;
  etag?: string | null;
  lastModified?: string | null;
  userId?: string | null;
}

export async function fetchFeedXml(
  url: string,
  options: FetchFeedXmlOptions,
): Promise<FetchFeedXmlResult> {
  if (isRssHubUrl(url)) {
    const routePath = getRssHubRoutePath(url);
    if (!routePath) {
      return { status: 400, xml: null, etag: null, lastModified: null };
    }

    const headers = new Headers({
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'user-agent': options.userAgent,
    });
    if (options.etag) headers.set('if-none-match', options.etag);
    if (options.lastModified) headers.set('if-modified-since', options.lastModified);

    // 抖音等平台需要登录 Cookie 才能绕过反爬，注入当前订阅所属用户的 Cookie。
    const finalHeaders = options.userId
      ? await injectRssHubCookieHeader(routePath, options.userId, headers)
      : headers;

    const response = await fetchEmbeddedRssHubRoute(routePath, { headers: finalHeaders });
    return {
      status: response.status,
      xml: response.status === 304 ? null : await response.text(),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  }

  const res = await fetchRssXml(url, {
    ...options,
    logging: {
      userId: options.userId ?? null,
      source: 'server/rss/fetchFeedXml',
      requestLabel: 'RSS fetch',
      context: {
        feedUrl: url,
      },
    },
  });

  return {
    status: res.status,
    xml: res.xml,
    etag: res.etag,
    lastModified: res.lastModified,
  };
}
