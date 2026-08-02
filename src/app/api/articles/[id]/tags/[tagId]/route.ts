import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { removeTagFromArticle } from '@/server/domains/tags/repositories/tagsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: numericIdSchema,
  tagId: z.string().uuid(),
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        if (!fields[key]) fields[key] = '不支持的参数';
      }
      continue;
    }
    const key = issue.path.join('.') || 'params';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; tagId: string }> },
) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  try {
    const params = await context.params;
    const paramsParsed = paramsSchema.safeParse(params);
    if (!paramsParsed.success) {
      return fail(new ValidationError('Invalid route params', zodIssuesToFields(paramsParsed.error)));
    }

    const pool = getPool();
    const removed = await removeTagFromArticle(
      pool,
      Number(paramsParsed.data.id),
      paramsParsed.data.tagId,
    );
    if (!removed) return fail(new NotFoundError('该标签未关联到此文章'));
    return ok({ removed: true });
  } catch (err) {
    return fail(err);
  }
}
