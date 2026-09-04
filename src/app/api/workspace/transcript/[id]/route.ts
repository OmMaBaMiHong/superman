import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { existsSync } from 'fs';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import {
  getWorkspaceMaterial,
  saveWorkspaceTranscript,
} from '@/server/services/workspace/material';
import { transcribeLocalVideo } from '@/server/services/video/transcript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.coerce.number().int().positive();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = Number(session.userId);

  const { id: rawId } = await params;
  const parsed = idSchema.safeParse(rawId);
  if (!parsed.success) {
    return fail(new ValidationError('无效的素材 ID', { id: '必须提供有效的素材 ID' }));
  }

  try {
    const material = await getWorkspaceMaterial(parsed.data, userId);
    if (!material) {
      return fail(new NotFoundError('未找到该素材'));
    }
    if (material.kind !== 'video') {
      return fail(new ValidationError('仅视频素材支持文案提取', { id: '该素材不是视频' }));
    }
    if (!material.filePath || !existsSync(material.filePath)) {
      return fail(new NotFoundError('视频文件不存在，请重新上传'));
    }

    // 本地素材没有可用的网络字幕，直接走 Whisper 语音识别
    const result = await transcribeLocalVideo(material.filePath);

    await saveWorkspaceTranscript({
      id: material.id,
      userId,
      text: result.text,
      source: result.source,
      language: result.language ?? null,
    });

    return ok({
      text: result.text,
      source: result.source,
      language: result.language,
    });
  } catch (err) {
    console.error('[workspace/transcript] error:', err);
    return fail(err);
  }
}
