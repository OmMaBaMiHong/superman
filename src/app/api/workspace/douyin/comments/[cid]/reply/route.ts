import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { replyComment } from '@/server/services/douyin/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  awemeId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(2000),
});

/** 在线回复：触发 douyin-cli 发布回复到某条评论 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ cid: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const { cid } = await params;
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(new ValidationError('无效的请求', { text: '请提供要回复的内容' }));
    }
    const result = await replyComment({
      awemeId: parsed.data.awemeId,
      cid,
      text: parsed.data.text,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
