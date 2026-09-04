import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 为 OpenChatCut 提供工作区素材元数据（无鉴权，仅本地开发用）。
 * 返回素材标题、文件信息、文案等，供 OpenChatCut 导入编辑器（去剪辑）。
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
      `select
        id, kind, title, file_name, file_size, mime_type,
        transcript_text, transcript_source, transcript_language, transcript_extracted_at
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

    const r = rows[0];

    return NextResponse.json(
      {
        ok: true,
        data: {
          materialId: Number(r.id),
          kind: r.kind,
          title: r.title,
          fileName: r.file_name,
          fileSize: r.file_size,
          mimeType: r.mime_type,
          transcriptText: r.transcript_text,
          transcriptSource: r.transcript_source,
          transcriptLanguage: r.transcript_language,
          transcriptExtracted: !!r.transcript_extracted_at,
        },
      },
      { headers: corsHeaders },
    );
  } catch (err) {
    console.error('[workspace/material-data] error:', err);
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
