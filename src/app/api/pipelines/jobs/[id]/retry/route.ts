import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { retryPipelineJob } from '@/server/domains/pipelines/services/pipelineService';

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
      throw new ValidationError('任务 ID 非法', { id: '必须为正整数' });
    }
    const result = await retryPipelineJob(getPool(), {
      id: parsed.data.id,
      userId: session.userId,
    });
    return ok({ job: result.job, queueJobId: result.queueJobId });
  } catch (err) {
    return fail(err);
  }
}
