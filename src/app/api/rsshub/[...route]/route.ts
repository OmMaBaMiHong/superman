import { fetchEmbeddedRssHubRoute } from '@/server/integrations/rsshub/embeddedRssHubApp';
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

  return fetchEmbeddedRssHubRoute(routePath, {
    headers: request.headers,
  });
}
