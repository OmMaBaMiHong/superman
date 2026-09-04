import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { planCampaign, runCampaign, stopCampaign, pauseCampaign, resumeCampaign } from '@/server/services/douyin/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  action: z.enum(['plan', 'run', 'stop', 'pause', 'resume']),
});

/** 对自动回帖活动执行操作：plan(预生成)/run(启动daemon)/stop(停止)/pause(暂停)/resume(恢复) */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const { id } = await params;
    const campaignId = Number(id);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return fail(new ValidationError('无效的活动 ID', { id: '活动 ID 必须为正整数' }));
    }

    const body = await request.json().catch(() => null);
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return fail(new ValidationError('请指定 action: plan | run | stop | pause | resume', { action: '必填' }));
    }

    switch (parsed.data.action) {
      case 'plan':
        return ok(await planCampaign(campaignId));
      case 'run':
        return ok(await runCampaign(campaignId));
      case 'stop':
        return ok(await stopCampaign(campaignId));
      case 'pause':
        return ok(await pauseCampaign(campaignId));
      case 'resume':
        return ok(await resumeCampaign(campaignId));
    }
  } catch (err) {
    return fail(err);
  }
}