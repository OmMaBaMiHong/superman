/**
 * GET /api/trend-radar/items/[id] —— 热榜条目详情：行字段 + payload_json 全量返回。
 */
import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { getTrendRadarItem } from '@/server/domains/trendradar/repository';

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
      throw new ValidationError('id 取值非法', { id: '必须为正整数' });
    }

    const item = await getTrendRadarItem(getPool(), id, session.userId);
    if (!item) {
      throw new NotFoundError('热榜条目不存在或不属于当前用户');
    }
    return ok(item);
  } catch (err) {
    return fail(err);
  }
}
