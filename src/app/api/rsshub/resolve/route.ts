import { ok } from '@/server/infra/http/apiResponse';
import { resolveRssHubSourceUrl } from '@/server/integrations/rsshub/sourceResolver';
import { requireApiSession } from '@/server/domains/auth/services/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  const url = new URL(request.url).searchParams.get('url') ?? '';
  const result = await resolveRssHubSourceUrl(url);
  return ok(result);
}
