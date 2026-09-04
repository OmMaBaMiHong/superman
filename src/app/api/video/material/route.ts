import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getVideoMaterial } from '@/server/services/video/material';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  articleId: z.coerce.number().int().positive(),
});

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = Number(session.userId);

  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      articleId: url.searchParams.get('articleId'),
    });
    if (!parsed.success) {
      return fail(new ValidationError('无效的请求参数', { articleId: '必须提供有效的文章 ID' }));
    }

    const { articleId } = parsed.data;
    const material = await getVideoMaterial(articleId, userId);

    return ok(material);
  } catch (err) {
    return fail(err);
  }
}