import { requireApiSession } from '@/server/domains/auth/services/session';
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import {
  createWorkspaceMaterial,
  type WorkspaceMaterial,
} from '@/server/services/workspace/material';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 工作区素材根目录（与 downloads/ 同级，按用户分目录隔离） */
const WORKSPACE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'workspace');

/** 允许的最大上传体积：视频素材可能较大，放宽到 2GB */
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;

const VIDEO_MIME_PREFIXES = ['video/', 'application/mp4', 'application/x-mpegURL'];

function detectKind(mimeType: string | null, fileName: string): 'video' | 'file' {
  const ext = path.extname(fileName).toLowerCase();
  const videoExts = new Set([
    '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.flv', '.wmv', '.ts', '.m3u8',
  ]);
  if (mimeType && VIDEO_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return 'video';
  if (videoExts.has(ext)) return 'video';
  return 'file';
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-\u4e00-\u9fa5 ]+/g, '_').trim();
  return base || 'unnamed';
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = Number(session.userId);

  try {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return fail(new ValidationError('无效的上传请求', { file: '请求体不是合法的 multipart 数据' }));
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return fail(new ValidationError('缺少文件', { file: '请选择要上传的素材文件' }));
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return fail(new ValidationError('文件过大', { file: '单个素材不能超过 2GB' }));
    }

    // 可选：自定义标题（默认取文件名去扩展名）
    const rawTitle = formData.get('title');
    const titleSchema = z.string().trim().max(200).optional();
    const parsedTitle = titleSchema.safeParse(typeof rawTitle === 'string' ? rawTitle : undefined);
    const title = parsedTitle.success && parsedTitle.data ? parsedTitle.data : undefined;

    const fileName = sanitizeFileName(file.name);
    const mimeType = file.type || null;
    const kind = detectKind(mimeType, fileName);

    // 落盘到 uploads/workspace/{userId}/
    const userDir = path.join(WORKSPACE_UPLOAD_DIR, String(userId));
    await fs.mkdir(userDir, { recursive: true });
    const storedName = `${Date.now()}-${fileName}`;
    const filePath = path.join(userDir, storedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    const material = await createWorkspaceMaterial({
      userId,
      kind,
      title: title ?? fileName.replace(/\.[^.]+$/, ''),
      fileName,
      filePath,
      fileSize: file.size,
      mimeType,
    });

    return ok(material);
  } catch (err) {
    return fail(err);
  }
}

export type { WorkspaceMaterial };
