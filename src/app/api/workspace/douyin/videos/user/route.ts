import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { fetchUserVideos } from '@/server/services/douyin/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  target: z.string().trim().min(1).max(500),
  count: z.number().int().min(1).max(35).optional(),
});

/** 拉取指定用户的作品列表（douyin-cli user），支持 sec_user_id 或用户主页 URL */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        new ValidationError('无效的请求参数', {
          target: '请输入 sec_user_id 或用户主页 URL',
        }),
      );
    }
    return ok(await fetchUserVideos(parsed.data.target, parsed.data.count));
  } catch (err) {
    return fail(err);
  }
}
