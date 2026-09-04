import { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { hybridSearch } from '@/server/integrations/knowledge/searchService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    if (!q || !q.trim()) {
      return ok({ items: [] });
    }

    const results = await hybridSearch(q.trim(), 10);
    return ok({ items: results });
  } catch (err) {
    return fail(err);
  }
}