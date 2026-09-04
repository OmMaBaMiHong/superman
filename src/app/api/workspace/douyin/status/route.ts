import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { getBridgeStatus } from '@/server/services/douyin/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 抖音 Bridge 连接状态：浏览器油猴脚本是否在线 */
export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    return ok(await getBridgeStatus());
  } catch (err) {
    return fail(err);
  }
}
