import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { rejectGovernanceItem } from '@/server/domains/governance/services/governanceActionsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: numericIdSchema });
const bodySchema = z.object({
  reason: z.string().trim().max(1000).optional().default(''),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      throw new ValidationError('条目 ID 非法', { id: '必须为正整数' });
    }
    const body = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) {
      throw new ValidationError('驳回理由非法', { reason: 'reason 必须为不超过 1000 字的字符串' });
    }
    const item = await rejectGovernanceItem(getPool(), {
      id: parsed.data.id,
      reason: body.data.reason,
      userId: session.userId,
    });
    return ok({ item });
  } catch (err) {
    return fail(err);
  }
}
