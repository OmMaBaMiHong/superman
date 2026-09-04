import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { listComments } from '@/server/services/douyin/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 评论列表。Query 参数：
 * - awemeId: 按视频筛选
 * - replied: '1' 只看已回复 / '0' 只看待回复 / 缺省全部
 * - page / limit: 分页
 */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const url = new URL(request.url);
    const awemeId = url.searchParams.get('awemeId') || undefined;
    const repliedRaw = url.searchParams.get('replied');
    const replied =
      repliedRaw === '1' ? true : repliedRaw === '0' ? false : undefined;
    const page = Number(url.searchParams.get('page')) || 1;
    const limit = Number(url.searchParams.get('limit')) || 50;

    return ok(await listComments({ awemeId, replied, page, limit }));
  } catch (err) {
    return fail(err);
  }
}
