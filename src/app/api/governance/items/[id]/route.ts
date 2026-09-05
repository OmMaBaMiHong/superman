/**
 * GET /api/governance/items/[id] —— 治理条目详情（全文/图/来源），供详情 sheet 渲染。
 */
import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { getGovernanceItemDetail } from '@/server/domains/governance/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) {
      throw new ValidationError('条目 ID 非法', { id: '必须为正整数' });
    }

    const detail = await getGovernanceItemDetail(getPool(), { id, userId: session.userId });
    if (!detail) {
      throw new NotFoundError('条目不存在或不属于当前用户');
    }
    return ok(detail);
  } catch (err) {
    return fail(err);
  }
}
