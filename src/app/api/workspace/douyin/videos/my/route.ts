import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { fetchMyVideos } from '@/server/services/douyin/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  count: z.number().int().min(1).max(50).optional(),
});

/** 拉取「我的作品」列表（douyin-cli my），并落库到 douyin.videos（is_mine=1） */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(new ValidationError('无效的请求参数', { count: '数量需为 1-50 的整数' }));
    }
    return ok(await fetchMyVideos(parsed.data.count));
  } catch (err) {
    return fail(err);
  }
}
