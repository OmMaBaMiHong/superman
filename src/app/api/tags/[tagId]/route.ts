import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { updateTag, deleteTag } from '@/server/domains/tags/repositories/tagsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  tagId: z.string().uuid(),
});

const patchBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    color: z.string().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: 'At least one field must be provided',
    path: ['body'],
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
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ tagId: string }> },
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
    const tag = await updateTag(pool, paramsParsed.data.tagId, session.userId, bodyParsed.data);
    if (!tag) return fail(new NotFoundError('标签不存在'));
    return ok(tag);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ tagId: string }> },
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
    const deleted = await deleteTag(pool, paramsParsed.data.tagId, session.userId);
    if (!deleted) return fail(new NotFoundError('标签不存在'));
    return ok({ deleted: true });
  } catch (err) {
    return fail(err);
  }
}
