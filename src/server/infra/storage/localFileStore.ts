import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';

/**
 * 本地文件存储 — 保存上传的媒体文件到数据目录。
 * 存储路径: ~/.superman/uploads/<yyyy-MM>/<hash>.<ext>
 */

const DATA_DIR = path.join(
  process.env.SUPERMAN_DATA_DIR || path.join(process.env.HOME || '/tmp', '.superman'),
  'uploads',
);

function extOf(filename: string, mime: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot > 0) return filename.slice(dot);
  // fallback from mime
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  };
  return map[mime] || '';
}

function mimeToKind(mime: string): 'image' | 'video' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export interface SavedFile {
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  kind: 'image' | 'video' | 'file';
  /** 访问 URL（相对于 /s/app/media/） */
  url: string;
}

/** 保存单个文件，返回存储信息。 */
export async function saveUpload(file: File): Promise<SavedFile> {
  const ext = extOf(file.name, file.type);
  const hash = crypto.randomBytes(8).toString('hex');
  const fileName = `${Date.now()}_${hash}${ext}`;

  const now = new Date();
  const subDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(DATA_DIR, subDir);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const filePath = path.join(dir, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  return {
    fileName,
    filePath,
    fileSize: buffer.length,
    mimeType: file.type,
    kind: mimeToKind(file.type),
    url: `/s/app/media/${subDir}/${fileName}`,
  };
}

/** 批量保存文件。 */
export async function saveUploads(files: File[]): Promise<SavedFile[]> {
  return Promise.all(files.map(saveUpload));
}

/** 根据 URL 解析出本地文件路径（用于静态文件服务）。 */
export function resolveMediaPath(url: string): string | null {
  const prefix = '/s/app/media/';
  if (!url.startsWith(prefix)) return null;
  const rel = url.slice(prefix.length);
  // 防止路径穿越
  if (rel.includes('..')) return null;
  return path.join(DATA_DIR, rel);
}
