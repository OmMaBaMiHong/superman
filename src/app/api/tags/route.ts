import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { listTags, createTag } from '@/server/domains/tags/repositories/tagsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    color: z.string().optional(),
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

export async function GET() {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  try {
    const pool = getPool();
    const tags = await listTags(pool, session.userId);
    return ok(tags);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  try {
    const json = await request.json().catch(() => null);
    const parsed = createBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(parsed.error)));
    }

    const pool = getPool();
    const tag = await createTag(pool, session.userId, parsed.data.name, parsed.data.color);
    return ok(tag);
  } catch (err) {
    return fail(err);
  }
}
