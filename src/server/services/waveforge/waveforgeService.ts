/**
 * WaveForge 引擎服务客户端（生成同款视频）。
 * 引擎与本服务同机（127.0.0.1:9810），相片写到引擎可读的会话目录。
 * 生产把引擎迁云时只改 WAVEFORGE_URL，调用方无感。
 */
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const WAVEFORGE_URL = process.env.WAVEFORGE_URL ?? 'http://127.0.0.1:9810';
export const WAVEFORGE_TOKEN = process.env.WAVEFORGE_TOKEN ?? '';
const UPLOADS_ROOT = process.env.WAVEFORGE_UPLOADS_DIR
  ?? path.join(process.cwd(), 'uploads', 'waveforge');

/** v0.1 白名单：引擎侧已登记的开发模板（正式目录待 Chaos K1，见 waveforge docs/04） */
const ALLOWED_TEMPLATES = new Set(['bbq-store-v1']);
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS = 12;

export interface WaveforgePhoto {
  /** 文件名需携带槽位关键字（招牌/门脸/店内环境/菜品/价格/地址），引擎按文件名归槽 */
  name: string;
  base64: string;
}

export interface CreateRemakeInput {
  templateId: string;
  storeName: string;
  note?: string;
  session: string;
  photos: WaveforgePhoto[];
  /** 二创对标文案（如选题已有的视频转写），与 benchmarkUrl 二选一 */
  sourceText?: string;
  /** 对标视频链接：给了就由引擎自行下载并提取文案 */
  benchmarkUrl?: string;
}

export function isAllowedTemplate(id: string): boolean {
  return ALLOWED_TEMPLATES.has(id);
}

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'x-wf-product': 'dsh-plugin' };
  if (WAVEFORGE_TOKEN) headers['x-wf-token'] = WAVEFORGE_TOKEN;
  return headers;
}

/** 相片落盘：uploads/waveforge/<session>/<关键字>_<时间戳>.<ext>，返回目录与路径。 */
export async function savePhotos(
  session: string,
  photos: WaveforgePhoto[],
): Promise<{ dir: string; paths: string[] }> {
  const cleanSession = session.replace(/[^\w-]/g, '');
  if (!cleanSession) throw new Error('会话标识无效');
  if (photos.length === 0) throw new Error('至少上传一张相片');
  if (photos.length > MAX_PHOTOS) throw new Error(`相片最多 ${MAX_PHOTOS} 张`);

  const dir = path.join(UPLOADS_ROOT, cleanSession);
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const [i, photo] of photos.entries()) {
    const base = path.basename(photo.name ?? '');
    if (!base || !ALLOWED_EXT.test(base)) throw new Error(`第 ${i + 1} 张相片格式不支持（只收 jpg/png/webp）`);
    const decoded = Buffer.from(photo.base64.replace(/^data:[^,]+,/, ''), 'base64');
    if (decoded.byteLength === 0) throw new Error(`第 ${i + 1} 张相片内容为空`);
    if (decoded.byteLength > MAX_PHOTO_BYTES) throw new Error(`第 ${i + 1} 张相片超过 12MB`);
    const ext = (base.match(ALLOWED_EXT)?.[0] ?? '.jpg').toLowerCase();
    const target = path.join(dir, `${Date.now()}_${i}${ext}`);
    await writeFile(target, decoded);
    paths.push(target);
  }
  return { dir, paths };
}

export interface CreateRemakeResult {
  id: string;
}

export async function createRemakeJob(input: CreateRemakeInput): Promise<CreateRemakeResult> {
  if (!input.storeName?.trim()) throw new Error('缺少店名');
  if (!isAllowedTemplate(input.templateId)) throw new Error('同款不可用或不存在');
  if (!input.sourceText?.trim() && !input.benchmarkUrl?.trim()) {
    throw new Error('缺少对标内容（视频文案或对标链接）');
  }
  const { dir } = await savePhotos(input.session, input.photos);
  const res = await fetch(`${WAVEFORGE_URL}/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...engineHeaders() },
    body: JSON.stringify({
      sourceText: input.sourceText?.trim() || undefined,
      url: input.benchmarkUrl?.trim() || undefined,
      industry: 'bbq',
      storeName: input.storeName.trim(),
      note: input.note?.trim() || undefined,
      photosDir: dir,
      templateId: input.templateId,
      backend: 'preview',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `引擎错误 ${res.status}` }));
    throw new Error(err.error ?? `引擎错误 ${res.status}`);
  }
  return res.json() as Promise<CreateRemakeResult>;
}

export interface WaveforgeJob {
  id: string;
  status: string;
  steps: Array<{ step: string; startedAt: string; finishedAt?: string; error?: string }>;
  title?: string;
  error?: string;
  renderSeconds?: number;
}

export async function getJob(id: string): Promise<WaveforgeJob | null> {
  const res = await fetch(`${WAVEFORGE_URL}/v1/jobs/${encodeURIComponent(id)}`, {
    headers: engineHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`引擎错误 ${res.status}`);
  return res.json() as Promise<WaveforgeJob>;
}

export interface WaveforgeResult {
  status: string;
  title?: string;
  segments?: Array<{ say: string; shot: string }>;
  output?: { filePath: string; backend: string };
  renderSeconds?: number;
}

export async function getJobResult(id: string): Promise<WaveforgeResult | null> {
  const res = await fetch(`${WAVEFORGE_URL}/v1/jobs/${encodeURIComponent(id)}/result`, {
    headers: engineHeaders(),
  });
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw new Error(`引擎错误 ${res.status}`);
  return res.json() as Promise<WaveforgeResult>;
}

const PREVIEW_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** 分镜预览文件流（preview 后端产物：storyboard.html + photos/）。 */
export async function openPreviewFile(
  id: string,
  rel: string,
): Promise<{ stream: NodeJS.ReadableStream; size: number; mime: string } | null> {
  const result = await getJobResult(id);
  const filePath = result?.output?.filePath;
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  const target = path.resolve(dir, rel || 'storyboard.html');
  if (!target.startsWith(path.resolve(dir))) return null;
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) return null;
  return {
    stream: createReadStream(target),
    size: info.size,
    mime: PREVIEW_MIME[path.extname(target)] ?? 'application/octet-stream',
  };
}
