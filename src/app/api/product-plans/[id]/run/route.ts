import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import {
  resolveProductPlanAiConfig,
  runProductPlanPipeline,
} from '@/core/product-plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: numericIdSchema });
const bodySchema = z.object({ force: z.boolean().optional() }).optional();

/**
 * POST /api/product-plans/:id/run —— 补齐 / 重跑产品计划流水线。
 * source → transcript → analysis → remix；默认只补缺失步骤，body.force=true 全部重跑。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      throw new ValidationError('产品计划 ID 非法', { id: '必须为正整数' });
    }
    const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsedBody.success) {
      throw new ValidationError('请求参数非法', { force: '必须为布尔值' });
    }
    const aiConfig = await resolveProductPlanAiConfig(getPool(), session.userId);
    const result = await runProductPlanPipeline(getPool(), {
      userId: session.userId,
      planId: parsedParams.data.id,
      aiConfig,
      force: parsedBody.data?.force === true,
    });
    if (!result) throw new NotFoundError('产品计划不存在');
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
