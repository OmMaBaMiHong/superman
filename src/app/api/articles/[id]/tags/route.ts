import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { getArticleTags, addTagsToArticle } from '@/server/domains/tags/repositories/tagsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: numericIdSchema,
});

const postBodySchema = z
  .object({
    tagIds: z.array(z.string().uuid()).min(1),
  })
  .strict();

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
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
    const tags = await getArticleTags(pool, Number(paramsParsed.data.id));
    return ok(tags);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
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
    const bodyParsed = postBodySchema.safeParse(json);
    if (!bodyParsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(bodyParsed.error)));
    }

    const pool = getPool();
    await addTagsToArticle(pool, Number(paramsParsed.data.id), bodyParsed.data.tagIds);
    return ok({ added: true });
  } catch (err) {
    return fail(err);
  }
}
