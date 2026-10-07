import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { saveUpload } from '@/server/infra/storage/localFileStore';
import { createClip } from '@/core/clips/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/clipboard/video — 上传视频并收藏。 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const formData = await request.formData();
    const videoFile = formData.get('video');

    if (!(videoFile instanceof File) || videoFile.size === 0) {
      return fail(new ValidationError('请选择视频', { video: '请选择一个视频文件' }));
    }

    const sourceUrl = typeof formData.get('sourceUrl') === 'string'
      ? (formData.get('sourceUrl') as string).trim()
      : '';

    const pool = getPool();

    // 1. 保存视频文件
    const saved = await saveUpload(videoFile);

    // 2. 保存到 video_materials 表（供后续口播/剪辑功能使用）
    //    先占位 article_id = 0，等 createClip 创建文章后再更新
    const videoResult = await pool.query(
      `
      insert into video_materials (
        article_id, user_id, video_url, video_title, provider,
        video_file_path, video_file_name, video_file_size
      ) values (0, $1, $2, $3, 'clipboard', $4, $5, $6)
      returning id
      `,
      [session.userId, saved.url, videoFile.name, saved.filePath, saved.fileName, saved.fileSize],
    );
    const videoMaterialId = videoResult.rows[0]?.id;

    // 3. 复用 createClip 服务
    const result = await createClip(pool, {
      userId: session.userId,
      title: videoFile.name.replace(/\.[^.]+$/, '').slice(0, 28),
      contentText: `视频素材：${videoFile.name}`,
      contentHtml: `<video src="${saved.url}" controls preload="metadata"></video>`,
      sourceUrl: sourceUrl || null,
      sourceTitle: videoFile.name,
    });

    // 4. 更新 video_materials 的 article_id
    if (videoMaterialId) {
      await pool.query(
        'update video_materials set article_id = $1 where id = $2',
        [result.articleId, videoMaterialId],
      );
    }

    return ok({
      article: {
        id: result.articleId,
        title: videoFile.name.replace(/\.[^.]+$/, '').slice(0, 28),
        summary: result.summary,
        directionKey: result.directionKey,
        qualityScore: result.qualityScore,
        origin: 'clipboard',
        videoUrl: saved.url,
        fileName: saved.fileName,
        alreadyExists: result.alreadyExists,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
