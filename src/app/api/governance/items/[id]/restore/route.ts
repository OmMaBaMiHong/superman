import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { restoreGovernanceItem } from '@/server/domains/governance/services/governanceActionsService';

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
      throw new ValidationError('条目 ID 非法', { id: '必须为正整数' });
    }
    const item = await restoreGovernanceItem(getPool(), {
      id: parsed.data.id,
      userId: session.userId,
    });
    return ok({ item });
  } catch (err) {
    return fail(err);
  }
}
