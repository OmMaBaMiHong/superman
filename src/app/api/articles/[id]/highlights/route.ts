import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError, ConflictError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import {
  listHighlights,
  createHighlight,
} from '@/server/domains/highlights/repositories/highlightsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: numericIdSchema,
});

const createSchema = z
  .object({
    text: z.string().min(1).max(10000),
    rangeStartSelector: z.string().min(1).max(500),
    rangeStartOffset: z.number().int().min(0),
    rangeEndSelector: z.string().min(1).max(500),
    rangeEndOffset: z.number().int().min(0),
    color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).default('yellow'),
    note: z.string().max(5000).nullable().optional(),
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
  if (session && 'response' in session) return session.response;

  try {
    const params = await context.params;
    const paramsParsed = paramsSchema.safeParse(params);
    if (!paramsParsed.success) {
      return fail(
        new ValidationError('Invalid route params', zodIssuesToFields(paramsParsed.error)),
      );
    }

    const pool = getPool();
    const highlights = await listHighlights(pool, session.userId, Number(paramsParsed.data.id));
    return ok(highlights);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const params = await context.params;
    const paramsParsed = paramsSchema.safeParse(params);
    if (!paramsParsed.success) {
      return fail(
        new ValidationError('Invalid route params', zodIssuesToFields(paramsParsed.error)),
      );
    }

    const json = await request.json().catch(() => null);
    const bodyParsed = createSchema.safeParse(json);
    if (!bodyParsed.success) {
      return fail(
        new ValidationError('Invalid request body', zodIssuesToFields(bodyParsed.error)),
      );
    }

    const pool = getPool();
    const highlight = await createHighlight(pool, {
      userId: session.userId,
      articleId: Number(paramsParsed.data.id),
      text: bodyParsed.data.text,
      rangeStartSelector: bodyParsed.data.rangeStartSelector,
      rangeStartOffset: bodyParsed.data.rangeStartOffset,
      rangeEndSelector: bodyParsed.data.rangeEndSelector,
      rangeEndOffset: bodyParsed.data.rangeEndOffset,
      color: bodyParsed.data.color,
      note: bodyParsed.data.note ?? null,
    });
    return ok(highlight);
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    ) {
      return fail(new ConflictError('该文本范围已存在高亮'));
    }
    return fail(err);
  }
}
