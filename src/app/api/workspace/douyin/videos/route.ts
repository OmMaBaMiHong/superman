import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { listVideos } from '@/server/services/douyin/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 抖音视频列表（含每视频评论统计） */
export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    return ok(await listVideos());
  } catch (err) {
    return fail(err);
  }
}
