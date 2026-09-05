import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { listGovernanceQueue } from '@/server/domains/governance/repository';
import { isGovernanceStatus, type GovernanceStatus } from '@/server/domains/governance/stateMachine';

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
    const statusParam = url.searchParams.get('status');
    let statuses: GovernanceStatus[] | undefined;
    if (statusParam) {
      const parts = statusParam.split(',').map((part) => part.trim()).filter(Boolean);
      if (!parts.every(isGovernanceStatus)) {
        throw new ValidationError('status 取值非法', { status: '仅支持 candidate/pending/archived/rejected/used' });
      }
      statuses = parts;
    }

    const categoryId = url.searchParams.get('categoryId');
    if (categoryId !== null && parsePositiveInt(categoryId) === null) {
      throw new ValidationError('categoryId 取值非法', { categoryId: '必须为正整数' });
    }

    const keyword = url.searchParams.get('keyword')?.trim() || undefined;
    if (keyword && keyword.length > 120) {
      throw new ValidationError('keyword 取值非法', { keyword: '最长 120 字符' });
    }

    const result = await listGovernanceQueue(getPool(), {
      userId: session.userId,
      statuses,
      categoryId: categoryId ?? undefined,
      keyword,
      page: parsePositiveInt(url.searchParams.get('page')) ?? 1,
      pageSize: parsePositiveInt(url.searchParams.get('pageSize')) ?? 20,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
