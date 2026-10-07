import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import {
  resolveProductPlanAiConfig,
  scanProductPlanCandidates,
} from '@/core/product-plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
});

/**
 * POST /api/product-plans/scan —— 批量扫描「搞钱」方向已归档文章，
 * 为尚未生成计划的内容逐篇推理产品机会（每轮上限 20，缺省 10）。
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'body';
        if (!fields[key]) fields[key] = issue.message;
      }
      throw new ValidationError('请求参数非法', fields);
    }
    const aiConfig = await resolveProductPlanAiConfig(getPool(), session.userId);
    const result = await scanProductPlanCandidates(getPool(), {
      userId: session.userId,
      limit: parsed.data.limit ?? 10,
      aiConfig,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
