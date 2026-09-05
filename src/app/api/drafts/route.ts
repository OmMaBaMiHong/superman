import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { listDrafts } from '@/server/domains/pipelines/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePositiveInt(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const url = new URL(request.url);
    const articleId = url.searchParams.get('articleId');
    if (articleId !== null && parsePositiveInt(articleId) === null) {
      throw new ValidationError('articleId 取值非法', { articleId: '必须为正整数' });
    }
    const platform = url.searchParams.get('platform');

    const result = await listDrafts(getPool(), {
      userId: session.userId,
      articleId: articleId ?? undefined,
      platform: platform?.trim() || undefined,
      page: parsePositiveInt(url.searchParams.get('page')) ?? 1,
      pageSize: parsePositiveInt(url.searchParams.get('pageSize')) ?? 20,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
