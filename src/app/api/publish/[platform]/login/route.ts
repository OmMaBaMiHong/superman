import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPublishServiceOrigin } from '@/server/integrations/publish/service';
import { getPlatformType, isPublishPlatform } from '@/lib/publish/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 平台扫码登录（SSE 转发）。
 *
 * 把 Python /login?type=<平台type>&id=<account> 的 text/event-stream 流原样转发给浏览器，
 * 前端用 EventSource 消费二维码图片与登录状态。account 作为该账号的 cookie 文件名标识。
 */
export async function GET(
  request: Request,
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

  const { searchParams } = new URL(request.url);
  const account = searchParams.get('account')?.trim();
  if (!account) {
    return Response.json({ code: 400, msg: '缺少 account 参数', data: null }, { status: 400 });
  }

  try {
    const upstreamUrl = new URL('/login', getPublishServiceOrigin());
    upstreamUrl.searchParams.set('type', String(getPlatformType(platform)));
    upstreamUrl.searchParams.set('id', account);

    const upstream = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { code: 502, msg: `发布服务登录接口异常（HTTP ${upstream.status}）`, data: null },
        { status: 502 },
      );
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '发起扫码登录失败';
    return Response.json({ code: 500, msg: message, data: null }, { status: 502 });
  }
}
