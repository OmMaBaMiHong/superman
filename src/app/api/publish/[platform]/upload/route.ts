import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPublishServiceOrigin } from '@/server/integrations/publish/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 上传待发布视频到随附 Python 服务（转发 multipart 到 /upload，各平台通用）。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  await context.params; // 校验平台段存在（上传本身平台无关）

  const formData = await request.formData().catch(() => null);
  if (!formData || !formData.get('file')) {
    return Response.json(
      { code: 400, msg: '缺少视频文件（file 字段）', data: null },
      { status: 400 },
    );
  }

  try {
    const serviceUrl = new URL('/upload', getPublishServiceOrigin());
    const res = await fetch(serviceUrl.toString(), {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300_000),
    });
    const payload = (await res.json().catch(() => null)) as { code?: number; msg?: string; data?: unknown } | null;
    if (!payload || typeof payload.code !== 'number') {
      return Response.json(
        { code: 500, msg: `发布服务返回异常（HTTP ${res.status}）`, data: null },
        { status: 502 },
      );
    }
    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传视频失败';
    return Response.json({ code: 500, msg: message, data: null }, { status: 502 });
  }
}
