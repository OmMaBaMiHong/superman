import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { forwardJson } from '@/server/integrations/publish/service';
import { getPlatformName, getPlatformType, isPublishPlatform } from '@/lib/publish/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const publishBodySchema = z.object({
  /** 已上传视频文件的文件名（Python 服务返回的 data） */
  file: z.string().trim().min(1),
  title: z.string().trim().min(1),
  /** 话题标签，不含 # 号 */
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
  /** 已登录账号的 cookie 文件名（账号列表里的 filePath） */
  account: z.string().min(1),
});

/** 发布视频到指定平台（转发到 Python /postVideo，type 由平台决定）。 */
export async function POST(
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

  const body = await request.json().catch(() => null);
  const parsed = publishBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: 400, msg: '请求参数不合法', data: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { file, title, tags, description, account } = parsed.data;
  const platformName = getPlatformName(platform);

  try {
    const payload = await forwardJson('POST', '/postVideo', {
      jsonBody: {
        type: getPlatformType(platform),
        fileList: [file],
        accountList: [account], // 账号为所选账号的 cookie 文件名（账号列表里的 filePath）
        title,
        tags,
        description: description ?? title,
        enableTimer: false,
      },
    });
    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : `发布到${platformName}失败`;
    return Response.json({ code: 500, msg: message, data: null }, { status: 502 });
  }
}
