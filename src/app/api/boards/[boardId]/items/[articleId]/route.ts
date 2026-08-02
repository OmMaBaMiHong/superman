import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { removeArticleFromBoard } from '@/server/domains/boards/repositories/boardsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  boardId: z.string().uuid(),
  articleId: numericIdSchema,
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ boardId: string; articleId: string }> },
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
    const articleId = Number(paramsParsed.data.articleId);
    const removed = await removeArticleFromBoard(pool, paramsParsed.data.boardId, articleId);
    if (!removed) return fail(new NotFoundError('Board item not found'));
    return ok({ removed: true });
  } catch (err) {
    return fail(err);
  }
}
