import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import {
  createProductPlanFromArticle,
  resolveProductPlanAiConfig,
} from '@/core/product-plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ articleId: numericIdSchema });

/**
 * POST /api/product-plans/generate —— 从一篇文章（采集内容）推理产品计划。
 * 幂等：同一文章已生成过则返回原计划。
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('请求参数非法', { articleId: '必须为正整数' });
    }
    const aiConfig = await resolveProductPlanAiConfig(getPool(), session.userId);
    const result = await createProductPlanFromArticle(getPool(), {
      userId: session.userId,
      articleId: parsed.data.articleId,
      aiConfig,
    });
    if (!result) throw new NotFoundError('文章不存在或不属于当前用户');
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
