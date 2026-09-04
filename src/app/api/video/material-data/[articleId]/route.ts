import { NextResponse } from 'next/server';
import { getPool } from '@/server/infra/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 为 OpenChatCut 提供视频素材元数据（无鉴权，仅本地开发用）。
 * 返回视频文件路径、文案、标题等信息，供 OpenChatCut 导入编辑器。
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
      `select
        id, article_id, user_id, video_url, video_title, provider,
        transcript_text, transcript_source, transcript_language, transcript_extracted_at,
        video_file_path, video_file_name, video_file_size, video_downloaded_at,
        created_at, updated_at
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

    const r = rows[0];

    return NextResponse.json(
      {
        ok: true,
        data: {
          articleId: Number(r.article_id),
          videoTitle: r.video_title,
          videoUrl: r.video_url,
          provider: r.provider,
          transcriptText: r.transcript_text,
          transcriptSource: r.transcript_source,
          transcriptLanguage: r.transcript_language,
          videoFileName: r.video_file_name,
          videoFileSize: r.video_file_size,
          videoDownloaded: !!r.video_downloaded_at,
          transcriptExtracted: !!r.transcript_extracted_at,
        },
      },
      { headers: corsHeaders },
    );
  } catch (err) {
    console.error('[video/material-data] error:', err);
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