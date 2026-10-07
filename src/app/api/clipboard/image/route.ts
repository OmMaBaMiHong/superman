import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { saveUploads } from '@/server/infra/storage/localFileStore';
import { createClip } from '@/core/clips/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/clipboard/image — 上传图片并收藏。 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const formData = await request.formData();
    const images = formData.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);

    if (images.length === 0) {
      return fail(new ValidationError('请选择图片', { images: '至少选择一张图片' }));
    }

    const sourceUrl = typeof formData.get('sourceUrl') === 'string'
      ? (formData.get('sourceUrl') as string).trim()
      : '';

    const pool = getPool();

    // 1. 保存文件到本地存储
    const savedFiles = await saveUploads(images);
    const imageUrls = savedFiles.map((f) => f.url);

    // 2. 复用 createClip 服务（方向分类 + AI 摘要 + 入库）
    const result = await createClip(pool, {
      userId: session.userId,
      title: `${images.length} 张图片收藏`,
      contentText: `从外部收藏的 ${images.length} 张图片素材`,
      contentHtml: imageUrls.map((u) => `<img src="${u}" />`).join('\n'),
      sourceUrl: sourceUrl || null,
      sourceTitle: `${images.length} 张图片收藏`,
      imageUrls,
    });

    return ok({
      article: {
        id: result.articleId,
        title: `${images.length} 张图片收藏`,
        summary: result.summary,
        directionKey: result.directionKey,
        qualityScore: result.qualityScore,
        origin: 'clipboard',
        imageUrls,
        alreadyExists: result.alreadyExists,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
