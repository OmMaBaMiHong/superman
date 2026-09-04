import { readFileSync, statSync, existsSync } from 'fs';
import { NextResponse } from 'next/server';
import { getPool } from '@/server/infra/db/pool';
import { ensureH264Compat } from '@/server/services/video/download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 为 OpenChatCut 提供视频文件流（无鉴权，仅本地开发用）。
 * OpenChatCut 运行在 localhost:5199，通过该接口获取视频文件后导入编辑器。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { articleId } = await params;
  const id = Number(articleId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json(
      { ok: false, error: { message: '无效的 articleId' } },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `select video_file_path, video_file_name
       from video_materials
       where article_id = $1
       limit 1`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: { message: '未找到视频素材' } },
        { status: 404, headers: corsHeaders },
      );
    }

    const { video_file_path, video_file_name } = rows[0];
    if (!video_file_path || !existsSync(video_file_path)) {
      return NextResponse.json(
        { ok: false, error: { message: '视频文件不存在' } },
        { status: 404, headers: corsHeaders },
      );
    }

    // 归一化为 H.264，确保 OpenChatCut 内置 ffprobe 可解析（其 4.4 版本不支持 AV1）
    const normalizedPath = await ensureH264Compat(video_file_path);
    if (normalizedPath !== video_file_path) {
      const normalizedName = normalizedPath.split('/').pop() ?? video_file_name;
      await pool.query(
        `update video_materials
         set video_file_path = $1, video_file_name = $2, video_file_size = $3, updated_at = now()
         where article_id = $4`,
        [normalizedPath, normalizedName, existsSync(normalizedPath) ? statSync(normalizedPath).size : 0, id],
      ).catch((err) => console.error('[video/serve] update db error:', err));
    }

    const buffer = readFileSync(normalizedPath);
    const ext = video_file_name?.split('.').pop()?.toLowerCase() ?? 'mp4';
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
    };
    const contentType = mimeMap[ext] || 'video/mp4';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(video_file_name ?? 'video.' + ext)}`,
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error('[video/serve] error:', err);
    return NextResponse.json(
      { ok: false, error: { message: '服务暂时不可用' } },
      { status: 500, headers: corsHeaders },
    );
  }
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}