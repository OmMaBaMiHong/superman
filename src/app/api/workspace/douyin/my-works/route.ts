import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { listMyWorks, refreshMyWorks } from '@/server/services/douyin/myWorksService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 「我的作品」数据源为用户的 RSSHub 抖音主页订阅（douyin/user），
 * 数据从 articles 表读取，无需浏览器 / 油猴脚本。
 *
 * GET  → 作品列表 + 汇总仪表盘
 * POST → 强制刷新订阅（enqueue feed.fetch）
 */
export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const userId = session.userId;
    const data = await listMyWorks(userId);
    return ok(data);
  } catch (err) {
    return fail(err);
  }
}

export async function POST() {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const userId = session.userId;
    const { feedId } = await listMyWorks(userId);
    if (!feedId) {
      return ok({ refreshed: false, jobId: null, reason: 'not_subscribed' });
    }
    const { jobId } = await refreshMyWorks(feedId, userId);
    return ok({ refreshed: true, jobId });
  } catch (err) {
    return fail(err);
  }
}
