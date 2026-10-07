import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { getPool } from '@/server/infra/db/pool';
import { getProductPlanStats } from '@/core/product-plans/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/product-plans/stats —— 产品计划统计（总量 / 各状态 / 两个来源计数）。 */
export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    return ok(await getProductPlanStats(getPool(), session.userId));
  } catch (err) {
    return fail(err);
  }
}
