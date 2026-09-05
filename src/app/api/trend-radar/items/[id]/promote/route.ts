/**
 * POST /api/trend-radar/items/[id]/promote —— 把热榜条目转为选题（治理 candidate）。
 *
 * 幂等：已转过的条目返回原 articleId（alreadyPromoted=true），不重复进审批台。
 */
import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { promoteTrendRadarItem } from '@/server/domains/trendradar/promote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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
      throw new ValidationError('id 取值非法', { id: '必须为正整数' });
    }

    const result = await promoteTrendRadarItem(getPool(), {
      id,
      userId: session.userId,
    });
    if (!result.ok) {
      throw new NotFoundError('热榜条目不存在或不属于当前用户');
    }

    return ok({
      itemId: id,
      articleId: result.articleId,
      alreadyPromoted: result.alreadyPromoted,
    });
  } catch (err) {
    return fail(err);
  }
}
