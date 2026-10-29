/**
 * 视频封面（首帧）生成 —— 收藏的视频条目在瀑布流里要有个封面，否则只有播放角标。
 *
 * 用本机 ffmpeg 抽第一帧（-ss 0.5 避开开头的黑帧），结果与视频同目录同名 + `.poster.jpg`，
 * 通过既有的 /s/api/media/* 直接伺服。ffmpeg 不存在时返回 null，不阻断收藏流程。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 生成/复用的封面路径；失败返回 null（不抛）。 */
export async function ensureVideoPoster(videoPath: string, atSeconds = 0.5): Promise<string | null> {
  if (!videoPath || !existsSync(videoPath)) return null;
  const posterPath = videoPath.replace(/\.[^./\\]+$/, '') + '.poster.jpg';
  if (existsSync(posterPath)) return posterPath;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-ss', String(atSeconds), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', posterPath],
        { stdio: 'ignore' },
      );
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    });
  } catch {
    return null;
  }
  return existsSync(posterPath) ? posterPath : null;
}

/** 视频 URL（/s/api/media/<rel> 或旧前缀）→ 同目录 poster 的 URL；不是媒体 URL 返回 null。 */
export function posterUrlFor(videoUrl: string): string | null {
  const prefix = ['/s/api/media/', '/s/app/media/'].find((p) => videoUrl.startsWith(p));
  if (!prefix) return null;
  const rel = videoUrl.slice(prefix.length).replace(/\.[^./\\]+$/, '.poster.jpg');
  return `/s/api/media/${rel}`;
}
