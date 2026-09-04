import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { createCampaign } from '@/server/services/douyin/runner';
import { listCampaigns } from '@/server/services/douyin/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(60),
  goal: z.string().max(120).optional().nullable(),
  videos: z.array(z.string()).max(30).optional(),
  dailyQuota: z.number().int().min(1).max(500).optional(),
  minPriority: z.number().int().min(0).max(5).optional(),
});

/** 自动回帖活动列表 */
export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    return ok(await listCampaigns());
  } catch (err) {
    return fail(err);
  }
}

/** 创建自动回帖活动（douyin-cli campaign create） */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return fail(new ValidationError('无效的请求参数', { campaign: '请检查活动名称与视频列表' }));
    }
    return ok(await createCampaign(parsed.data));
  } catch (err) {
    return fail(err);
  }
}
