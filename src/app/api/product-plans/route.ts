import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import {
  isProductPlanSourceType,
  isProductPlanStatus,
  listProductPlans,
  type ProductPlanSourceType,
  type ProductPlanStatus,
} from '@/core/product-plans/repository';
import {
  createManualProductPlan,
  resolveProductPlanAiConfig,
} from '@/core/product-plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createBodySchema = z.object({
  rawIdea: z.string().trim().min(1, '想法内容不能为空').max(20000, '最长 20000 字符'),
  note: z.string().max(4000).nullable().optional(),
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/**
 * GET /api/product-plans —— 列产品计划（人工口述 + AI 内容推理两个来源）。
 * 支持按状态 / 来源 / 关键词过滤，分页返回。
 */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status')?.trim() || undefined;
  if (status && !isProductPlanStatus(status)) {
    return fail(new ValidationError('status 取值非法', { status: '仅支持 idea/validating/building/launched/archived' }));
  }
  const source = url.searchParams.get('source')?.trim() || undefined;
  if (source && !isProductPlanSourceType(source)) {
    return fail(new ValidationError('source 取值非法', { source: '仅支持 manual/ai_inferred' }));
  }
  const keyword = url.searchParams.get('keyword')?.trim() || undefined;
  if (keyword && keyword.length > 120) {
    return fail(new ValidationError('keyword 取值非法', { keyword: '最长 120 字符' }));
  }
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  try {
    const result = await listProductPlans(getPool(), {
      userId: session.userId,
      status: status as ProductPlanStatus | undefined,
      sourceType: source as ProductPlanSourceType | undefined,
      keyword,
      limit,
      offset,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/product-plans —— 人工口述一个产品想法，AI 整理成 MVP 规划。
 * 未配置 AI 时回退启发式占位（可在 UI 继续编辑），绝不阻塞落库。
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = createBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('请求参数非法', zodIssuesToFields(parsed.error));
    }
    const aiConfig = await resolveProductPlanAiConfig(getPool(), session.userId);
    const result = await createManualProductPlan(getPool(), {
      userId: session.userId,
      rawIdea: parsed.data.rawIdea,
      note: parsed.data.note ?? null,
      aiConfig,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
