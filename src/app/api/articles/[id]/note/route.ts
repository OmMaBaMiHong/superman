import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { updateArticleUserNote } from '@/server/domains/articles/repositories/articlesRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: numericIdSchema });
const bodySchema = z
  .object({
    note: z.string().max(4000).optional(),
    title: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => v.note !== undefined || v.title !== undefined, {
    message: '至少提供 note 或 title',
    path: ['body'],
  });

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** PUT /api/articles/:id/note —— 更新收藏备注 / 想法（可同时改标题）。 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) {
      throw new ValidationError('收藏 ID 非法', { id: '必须为正整数' });
    }
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      throw new ValidationError('请求参数非法', zodIssuesToFields(body.error));
    }
    const updated = await updateArticleUserNote(getPool(), {
      id: params.data.id,
      userId: session.userId,
      note: body.data.note,
      title: body.data.title,
    });
    if (!updated) throw new NotFoundError('收藏不存在或不属于当前用户');
    return ok({ updated: true });
  } catch (err) {
    return fail(err);
  }
}
