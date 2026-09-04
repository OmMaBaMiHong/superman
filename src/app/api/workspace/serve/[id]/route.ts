import { readFileSync, statSync, existsSync } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ensureH264Compat } from '@/server/services/video/download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 为 OpenChatCut 提供工作区视频文件流（无鉴权，仅本地开发用）。
 * OpenChatCut 运行在 localhost:5199，通过该接口获取视频文件后导入编辑器。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const parsed = z.coerce.number().int().positive().safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { message: '无效的素材 ID' } },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `select kind, title, file_name, file_path, file_size
       from workspace_materials
       where id = $1
       limit 1`,
      [parsed.data],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: { message: '未找到素材' } },
        { status: 404, headers: corsHeaders },
      );
    }

    const { kind, title, file_name, file_path } = rows[0];
    if (kind !== 'video' || !file_path || !existsSync(file_path)) {
      return NextResponse.json(
        { ok: false, error: { message: '视频文件不存在' } },
        { status: 404, headers: corsHeaders },
      );
    }

    // 归一化为 H.264，确保 OpenChatCut 内置 ffprobe 可解析（其 4.4 版本不支持 AV1）
    const normalizedPath = await ensureH264Compat(file_path);
    if (normalizedPath !== file_path) {
      const normalizedName = normalizedPath.split('/').pop() ?? file_name;
      await pool.query(
        `update workspace_materials
         set file_path = $1, file_name = $2, file_size = $3, updated_at = now()
         where id = $4`,
        [normalizedPath, normalizedName, existsSync(normalizedPath) ? statSync(normalizedPath).size : 0, parsed.data],
      ).catch((err) => console.error('[workspace/serve] update db error:', err));
    }

    const buffer = readFileSync(normalizedPath);
    // 扩展名：file_name 可能无扩展名（早期 URL 下载产物），一律兜底为 mp4
    const ext = path.extname(file_name ?? '').replace(/^\./, '').toLowerCase() || 'mp4';
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
    };
    const contentType = mimeMap[ext] || 'video/mp4';
    // 下载 / 保存时文件名始终带扩展名，避免无扩展名导致保存后无法识别播放
    const baseName = title?.replace(/\.[^.]+$/, '') || file_name?.replace(/\.[^.]+$/, '') || 'video';
    const downloadName = `${baseName}.${ext}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error('[workspace/serve] error:', err);
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
