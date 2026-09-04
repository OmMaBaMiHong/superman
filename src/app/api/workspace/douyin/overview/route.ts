import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { getOverview } from '@/server/services/douyin/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 仪表盘总览：评论总数 / 已回复 / 待回复 / 今日新增 / 情感分布 / 趋势 */
export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const overview = await getOverview(14);
    return ok(overview);
  } catch (err) {
    return fail(err);
  }
}
