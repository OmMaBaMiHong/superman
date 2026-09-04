import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { refreshComments } from '@/server/services/douyin/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 一键刷新：触发 douyin-cli 抓取该视频的最新评论（增量） */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ awemeId: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const { awemeId } = await params;
    const result = await refreshComments(awemeId);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
