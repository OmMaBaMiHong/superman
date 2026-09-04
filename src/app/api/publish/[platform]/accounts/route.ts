import { requireApiSession } from '@/server/domains/auth/services/session';
import { forwardJson } from '@/server/integrations/publish/service';
import { isPublishPlatform } from '@/lib/publish/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 获取某平台的账号列表（转发到 Python /getAccounts，按平台 type 过滤）。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  const { platform } = await context.params;
  if (!isPublishPlatform(platform)) {
    return Response.json({ code: 400, msg: '不支持的发布平台', data: null }, { status: 400 });
  }

  try {
    const payload = await forwardJson('GET', '/getAccounts');
    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取账号失败';
    return Response.json({ code: 500, msg: message, data: null }, { status: 502 });
  }
}
