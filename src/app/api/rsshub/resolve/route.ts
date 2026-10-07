import { ok } from '@/server/infra/http/apiResponse';
import { resolveRssHubSourceUrl } from '@/server/integrations/rsshub/sourceResolver';
import { requireApiSession } from '@/server/domains/auth/services/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 抖音作品链接需用浏览器反推作者，放宽函数超时
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  const url = new URL(request.url).searchParams.get('url') ?? '';
  const result = await resolveRssHubSourceUrl(url);
  return ok(result);
}
