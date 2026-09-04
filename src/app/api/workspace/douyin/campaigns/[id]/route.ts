import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { getCampaignStatus } from '@/server/services/douyin/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 单个自动回帖活动状态（活动 + 任务计数 + daemon 是否存活） */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const { id } = await params;
    return ok(await getCampaignStatus(Number(id)));
  } catch (err) {
    return fail(err);
  }
}
