import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { updateBoard, deleteBoard } from '@/server/domains/boards/repositories/boardsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  boardId: z.string().uuid(),
});

const patchBodySchema = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    icon: z.string().max(10).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ boardId: string }> },
) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  try {
    const params = await context.params;
    const paramsParsed = paramsSchema.safeParse(params);
    if (!paramsParsed.success) {
      return fail(new ValidationError('Invalid route params', zodIssuesToFields(paramsParsed.error)));
    }

    const json = await request.json().catch(() => null);
    const bodyParsed = patchBodySchema.safeParse(json);
    if (!bodyParsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(bodyParsed.error)));
    }

    const pool = getPool();
    const updated = await updateBoard(pool, paramsParsed.data.boardId, session.userId, bodyParsed.data);
    if (!updated) return fail(new NotFoundError('Board not found'));
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ boardId: string }> },
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
    const deleted = await deleteBoard(pool, paramsParsed.data.boardId, session.userId);
    if (!deleted) return fail(new NotFoundError('Board not found'));
    return ok({ deleted: true });
  } catch (err) {
    return fail(err);
  }
}
