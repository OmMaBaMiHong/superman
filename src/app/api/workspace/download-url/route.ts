import { requireApiSession } from '@/server/domains/auth/services/session';
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { downloadVideo } from '@/server/services/video/download';
import {
  createWorkspaceMaterial,
  type WorkspaceMaterial,
} from '@/server/services/workspace/material';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 工作区素材根目录（与上传目录一致，按用户分目录隔离） */
const WORKSPACE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'workspace');

const bodySchema = z.object({
  url: z.string().trim().min(1).max(2000),
});

/**
 * 通过 URL 解析并下载视频到工作区。
 *
 * 不限于 RSSHub 订阅源：任意 yt-dlp 支持的视频链接（B站 / 抖音 / 小红书 / YouTube 等）
 * 都可粘贴进来下载成素材，随后可进行文案提取 / 播放 / 去剪辑。
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = Number(session.userId);

  try {
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(new ValidationError('无效的请求', { url: '请提供要解析的视频链接' }));
    }
    const url = parsed.data.url;

    // 1. 用 yt-dlp 下载视频（内部自动归一化为 H.264，兼容剪辑器）
    const downloaded = await downloadVideo(url);

    // 2. 移动到工作区用户目录
    const userDir = path.join(WORKSPACE_UPLOAD_DIR, String(userId));
    await fs.mkdir(userDir, { recursive: true });
    const targetPath = path.join(userDir, `${Date.now()}-${downloaded.fileName}`);
    await fs.rename(downloaded.filePath, targetPath);

    // 3. 创建工作区素材记录
    const material = await createWorkspaceMaterial({
      userId,
      kind: 'video',
      title: downloaded.title,
      fileName: downloaded.fileName,
      filePath: targetPath,
      fileSize: downloaded.fileSize,
      mimeType: 'video/mp4',
    });

    return ok(material);
  } catch (err) {
    return fail(err);
  }
}

export type { WorkspaceMaterial };
