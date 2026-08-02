import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import {
  deleteHighlight,
  updateHighlight,
} from '@/server/domains/highlights/repositories/highlightsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).optional(),
    note: z.string().max(5000).nullable().optional(),
  })
  .strict();

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        if (!fields[key]) {
          fields[key] = '不支持的查询参数';
        }
      }
      continue;
    }

    const key = issue.path.join('.') || 'body';
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ highlightId: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const params = await context.params;
    const { highlightId } = params;

    const json = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        new ValidationError('Invalid request body', zodIssuesToFields(parsed.error)),
      );
    }

    const pool = getPool();
    const updated = await updateHighlight(pool, highlightId, session.userId, {
      color: parsed.data.color,
      note: parsed.data.note,
    });
    if (!updated) {
      return fail(new NotFoundError('Highlight not found'));
    }
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ highlightId: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const params = await context.params;
    const { highlightId } = params;

    const pool = getPool();
    const deleted = await deleteHighlight(pool, highlightId, session.userId);
    if (!deleted) {
      return fail(new NotFoundError('Highlight not found'));
    }
    return ok({ deleted: true });
  } catch (err) {
    return fail(err);
  }
}
