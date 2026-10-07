import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import {
  deleteProductPlan,
  getProductPlan,
  isProductPlanStatus,
  updateProductPlan,
  type UpdateProductPlanPatch,
} from '@/core/product-plans/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: numericIdSchema });

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  oneLiner: z.string().max(2000).optional(),
  productDesc: z.string().max(8000).optional(),
  targetUsers: z.string().max(4000).optional(),
  approach: z.string().max(4000).optional(),
  businessModel: z.string().max(4000).optional(),
  risks: z.string().max(4000).optional(),
  competitors: z.string().max(4000).optional(),
  pricing: z.string().max(4000).optional(),
  milestones: z.string().max(4000).optional(),
  validationPlan: z.string().max(4000).optional(),
  direction: z.string().max(2000).optional(),
  remixIdeas: z.string().max(8000).optional(),
  status: z.string().refine(isProductPlanStatus, '仅支持 idea/validating/building/launched/archived').optional(),
});

/** GET /api/product-plans/:id —— 单条产品计划详情。 */
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
      throw new ValidationError('产品计划 ID 非法', { id: '必须为正整数' });
    }
    const plan = await getProductPlan(getPool(), parsed.data.id, session.userId);
    if (!plan) throw new NotFoundError('产品计划不存在');
    return ok({ plan });
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/product-plans/:id —— 局部更新计划字段 / 状态。 */
export async function PUT(
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
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'body';
        if (!fields[key]) fields[key] = issue.message;
      }
      throw new ValidationError('请求参数非法', fields);
    }
    const patch: UpdateProductPlanPatch = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof value === 'string') {
        (patch as Record<string, string>)[key] = value;
      }
    }
    const plan = await updateProductPlan(getPool(), parsedParams.data.id, patch, session.userId);
    if (!plan) throw new NotFoundError('产品计划不存在');
    return ok({ plan });
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/product-plans/:id —— 删除产品计划。 */
export async function DELETE(
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
      throw new ValidationError('产品计划 ID 非法', { id: '必须为正整数' });
    }
    const deleted = await deleteProductPlan(getPool(), parsed.data.id, session.userId);
    if (!deleted) throw new NotFoundError('产品计划不存在');
    return ok({ deleted: true });
  } catch (err) {
    return fail(err);
  }
}
