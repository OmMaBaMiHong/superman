import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, readdirSync, statSync } from 'fs';
import { saveDownload } from './material';
import { buildDouyinCookieArgs, isDouyinUrl } from './douyinCookies';

const execFileAsync = promisify(execFile);

const YT_DLP_BIN = '/opt/homebrew/bin/yt-dlp';
const YT_DLP_BIN_FALLBACK = 'yt-dlp';

const FFMPEG_BIN = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const FFPROBE_BIN = existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';

const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads', 'video');

export interface DownloadResult {
  filePath: string;
  fileName: string;
  title: string;
  fileSize: number;
}

/**
 * 确保视频文件路径带 .mp4 扩展名。
 *
 * 下载 / 归一化后的文件内容都是 MP4 容器，但 yt-dlp 生成的文件名可能缺少扩展名
 * （或为其它扩展名），会导致浏览器保存后无扩展名无法识别播放。这里统一改名成 .mp4：
 * 有扩展名则替换，无扩展名则直接追加。
 */
async function ensureMp4FileName(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return filePath;
  const base = ext ? filePath.slice(0, -ext.length) : filePath;
  const target = `${base}.mp4`;
  await fs.rename(filePath, target).catch(() => {});
  return target;
}

function getBinary(): string {
  return existsSync(YT_DLP_BIN) ? YT_DLP_BIN : YT_DLP_BIN_FALLBACK;
}

function findDownloadedFile(expectedPath: string): { filePath: string; fileName: string; title: string; fileSize: number } | null {
  // 仅当目标文件已存在时才视为已下载，绝不回退到目录里其它文件，
  // 否则会把无关的旧缓存当成本次下载结果。
  if (!existsSync(expectedPath)) return null;
  const filePath = expectedPath;
  const fileName = path.basename(filePath);
  const title = fileName.replace(/\.[^.]+$/, '');
  const fileSize = statSync(filePath).size;
  return { filePath, fileName, title, fileSize };
}

/**
 * 探测视频视频流编码；返回 codec_name（如 h264 / av1）。
 */
export async function probeVideoCodec(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return stdout.trim().toLowerCase();
}

/**
 * 将视频归一化为浏览器/剪辑器兼容的 H.264 MP4（faststart）。
 * 若已是 h264 则原样返回；否则用系统 ffmpeg 转码，成功后删除原文件。
 */
export async function ensureH264Compat(filePath: string): Promise<string> {
  const codec = await probeVideoCodec(filePath).catch(() => '');
  if (codec === 'h264' || codec === '') return filePath;

  const dir = path.dirname(filePath);
  const target = path.join(dir, `${path.basename(filePath, path.extname(filePath))}.compat.mp4`);
  await execFileAsync(FFMPEG_BIN, [
    '-y', '-i', filePath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    target,
  ]);
  await fs.unlink(filePath).catch(() => {});
  return target;
}

export async function downloadVideo(url: string, articleId?: number, userId?: number): Promise<DownloadResult> {
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true });

  const outputTemplate = path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s');
  const bin = getBinary();
  const { args: cookieArgs, cleanup: cookieCleanup } = await buildDouyinCookieArgs(url, userId);

  try {
    // 先获取预计文件名
    const { stdout: filenameOut } = await execFileAsync(bin, [
      '--print', 'filename',
      '-o', outputTemplate,
      '--no-playlist',
      ...cookieArgs,
      url,
    ]);
  const expectedPath = filenameOut.trim();

  // 检查是否已下载
  const existing = findDownloadedFile(expectedPath);
  if (existing) {
    // 已存在的文件也归一化为 H.264，兼容 OpenChatCut 内置 ffprobe；并确保扩展名为 .mp4
    const filePath = await ensureMp4FileName(await ensureH264Compat(existing.filePath));
    const fileName = path.basename(filePath);
    const title = fileName.replace(/\.compat\.mp4$/, '').replace(/\.[^.]+$/, '');
    const fileSize = statSync(filePath).size;
    const normalized = { filePath, fileName, title, fileSize };
    // 异步保存到数据库（不阻塞返回）
    if (articleId && userId) {
      saveDownload({
        articleId, userId,
        videoUrl: url,
        videoTitle: normalized.title,
        provider: '',
        filePath: normalized.filePath,
        fileName: normalized.fileName,
        fileSize: normalized.fileSize,
      }).catch(() => {});
    }
    return normalized;
  }

  // 记录下载前的文件列表
  const beforeFiles = new Set(existsSync(DOWNLOADS_DIR) ? readdirSync(DOWNLOADS_DIR) : []);

  // 下载视频
  await execFileAsync(bin, [
    '-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio/best[ext=mp4]/best',
    '-o', outputTemplate,
    '--no-playlist',
    '--no-progress',
    ...cookieArgs,
    url,
  ]);

  // 查找下载后的新文件
  const afterFiles = readdirSync(DOWNLOADS_DIR);
  const newFiles = afterFiles.filter((f) => !beforeFiles.has(f));
  if (newFiles.length > 0) {
    const newest = newFiles
      .map((f) => {
        try {
          const s = statSync(path.join(DOWNLOADS_DIR, f));
          return { name: f, mtime: s.mtimeMs };
        } catch { return null; }
      })
      .filter((f): f is { name: string; mtime: number } => f !== null)
      .sort((a, b) => b.mtime - a.mtime);
    const originalPath = path.join(DOWNLOADS_DIR, newest[0].name);

    // 归一化为 H.264，确保 OpenChatCut 等剪辑器可正常解码（内置 ffprobe 不支持 AV1）；并确保扩展名为 .mp4
    const filePath = await ensureMp4FileName(await ensureH264Compat(originalPath));
    const fileName = path.basename(filePath);
    const title = fileName.replace(/\.compat\.mp4$/, '').replace(/\.[^.]+$/, '');
    const fileSize = statSync(filePath).size;
    const result = { filePath, fileName, title, fileSize };

    // 保存到数据库
    if (articleId && userId) {
      await saveDownload({
        articleId, userId,
        videoUrl: url,
        videoTitle: title,
        provider: '',
        filePath, fileName, fileSize,
      }).catch(() => {});
    }
    return result;
  }

  throw new Error(`下载失败：未找到下载文件`);
  } finally {
    await cookieCleanup();
  }
}

export interface VideoInfo {
  title: string;
  description: string;
  duration: number;
  webpageUrl: string;
  thumbnail: string;
  subtitles: Record<string, { url: string; ext: string }[]>;
  automaticCaptions: Record<string, { url: string; ext: string }[]>;
}

export async function getVideoInfo(url: string, userId?: number): Promise<VideoInfo> {
  const bin = getBinary();
  const { args: cookieArgs, cleanup: cookieCleanup } = await buildDouyinCookieArgs(url, userId);

  try {
    const { stdout } = await execFileAsync(bin, [
      '--dump-json',
      '--no-playlist',
      ...cookieArgs,
      url,
    ]);

    const raw = JSON.parse(stdout);

    return {
      title: raw.title ?? '',
      description: raw.description ?? '',
      duration: raw.duration ?? 0,
      webpageUrl: raw.webpage_url ?? url,
      thumbnail: raw.thumbnail ?? '',
      subtitles: raw.subtitles ?? {},
      automaticCaptions: raw.automatic_captions ?? {},
    };
  } finally {
    await cookieCleanup();
  }
}

/**
 * 清理下载目录中的旧文件（超过指定时间）
 */
export async function cleanupDownloads(maxAgeMs = 3_600_000) {
  try {
    const files = await fs.readdir(DOWNLOADS_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  } catch {
    // 目录不存在时忽略
  }
}