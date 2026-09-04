import { fetchEmbeddedRssHubRoute } from '@/server/integrations/rsshub/embeddedRssHubApp';
import { injectRssHubCookieHeader } from '@/server/integrations/rsshub/rssHubCookieInjector';
import { requireApiSession } from '@/server/domains/auth/services/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RssHubRouteContext {
  params: Promise<{
    route: string[];
  }>;
}

function encodeRouteSegment(segment: string): string {
  return encodeURIComponent(segment).replaceAll('%40', '@');
}

export async function GET(request: Request, context: RssHubRouteContext) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  const params = await context.params;
  const incomingUrl = new URL(request.url);
  const routePath = `/${params.route.map(encodeRouteSegment).join('/')}${incomingUrl.search}`;

  // 抖音等平台需要登录 Cookie 才能绕过反爬，注入当前登录用户的 Cookie。
  const headers = await injectRssHubCookieHeader(routePath, session.userId, request.headers);

  return fetchEmbeddedRssHubRoute(routePath, {
    headers,
  });
}
