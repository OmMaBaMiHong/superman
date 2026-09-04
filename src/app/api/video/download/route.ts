import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { downloadVideo } from '@/server/services/video/download';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// articleId 在应用内为 string（Article.id），但部分调用方可能传 number，统一做兼容转换
const articleIdSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/).transform((v) => Number(v))])
  .nullable()
  .optional();

const bodySchema = z.object({
  url: z.string().url(),
  articleId: articleIdSchema,
});

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = session.userId ? Number(session.userId) : undefined;

  try {
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(new ValidationError('无效的请求参数', { url: '必须提供有效的视频 URL' }));
    }

    const { url, articleId } = parsed.data;
    const result = await downloadVideo(url, articleId ?? undefined, userId);

    // 读取文件并返回
    const buffer = fs.readFileSync(result.filePath);
    const fileName = encodeURIComponent(result.fileName);

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename*=UTF-8''${fileName}`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err) {
    console.error('[video/download] error:', err);
    return fail(err);
  }
}