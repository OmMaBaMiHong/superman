import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { acceptDraft, getDraftDetail } from '@/server/domains/pipelines/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: numericIdSchema });

export async function POST(
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
    const draft = await acceptDraft(getPool(), parsed.data.id, session.userId);
    if (!draft) {
      // 区分「不存在」与「状态不允许」，先读一次详情。
      const existing = await getDraftDetail(getPool(), parsed.data.id, session.userId);
      if (!existing) throw new NotFoundError('草稿不存在');
      throw new ConflictError(`当前状态（${existing.status}）不允许确认`);
    }
    return ok({ draft });
  } catch (err) {
    return fail(err);
  }
}
