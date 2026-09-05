import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { getDraftDetail } from '@/server/domains/pipelines/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: numericIdSchema });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      throw new ValidationError('草稿 ID 非法', { id: '必须为正整数' });
    }
    const draft = await getDraftDetail(getPool(), parsed.data.id, session.userId);
    if (!draft) throw new NotFoundError('草稿不存在');
    return ok({ draft });
  } catch (err) {
    return fail(err);
  }
}
