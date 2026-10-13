/**
 * yt-dlp / ffmpeg 二进制解析与自举（桌面端 Win/Mac）。
 *
 * 解析优先级（找到即返回）：
 *   ①环境变量 SUPERMAN_YTDLP_BIN / SUPERMAN_FFMPEG_BIN（用户自指定）
 *   ②包自带二进制：ffmpeg-static（装包时下载）/ youtube-dl-exec 的 bin/
 *   ③~/.dsh/bin 首次使用自动下载（yt-dlp 走 npmmirror 国内镜像优先，
 *     GitHub release 兜底；ffmpeg 依赖 ffmpeg-static 已随包就位）
 *   ④PATH 回退（homebrew 等用户自装，保持旧行为）
 *
 * 为什么不用 youtube-dl-exec 的 postinstall 当唯一通道：它从 GitHub releases
 * 下载，国内网络常被拒——镜像优先 + 首用自举才是用户零配置的关键。
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { chmodSync, existsSync, mkdirSync } from 'fs';
import { createWriteStream } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const require = createRequire(import.meta.url);
const BIN_DIR = join(homedir(), '.dsh', 'bin');

/** 平台对应的 yt-dlp 单文件资产名（npmmirror 镜像与 GitHub releases 同名）。 */
function ytDlpAssetName(): string {
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'win32') return 'yt-dlp.exe';
  return 'yt-dlp_linux';
}

function ytDlpLocalPath(): string {
  return join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function firstExisting(paths: Array<string | undefined>): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function ytDlpPkgBin(): string | undefined {
  try {
    const pkgDir = require.resolve('youtube-dl-exec/package.json').replace('package.json', '');
    return join(pkgDir, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  } catch {
    return undefined;
  }
}

/** 同步解析现存的 yt-dlp；都不存在时返回 'yt-dlp'（PATH 回退标记）。 */
export function resolveYtDlp(): string {
  const env = process.env.SUPERMAN_YTDLP_BIN?.trim();
  return (
    firstExisting([
      env,
      existsSync(BIN_DIR) ? ytDlpLocalPath() : undefined,
      ytDlpPkgBin(),
      '/opt/homebrew/bin/yt-dlp',
    ]) ?? 'yt-dlp'
  );
}

/** 首用自举：yt-dlp 不存在时从镜像下载到 ~/.dsh/bin（npmmirror 优先，GitHub 兜底）。 */
export async function ensureYtDlp(): Promise<string> {
  const resolved = resolveYtDlp();
  const pathFallback = resolved === 'yt-dlp' && !existsSync(resolved);
  if (!pathFallback) return resolved;

  const asset = ytDlpAssetName();
  const target = ytDlpLocalPath();
  mkdirSync(BIN_DIR, { recursive: true });
  const urls = [
    `https://registry.npmmirror.com/-/binary/yt-dlp/${asset}`,
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`,
  ];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(target));
      if (process.platform !== 'win32') chmodSync(target, 0o755);
      if (existsSync(target) && existsSync(target)) return target;
    } catch (err) {
      lastError = err;
      existsSync(target) && require('fs').unlinkSync(target);
    }
  }
  throw new Error(
    `yt-dlp 自动下载失败（${String(lastError).slice(0, 80)}）。请手动下载 ${asset} 放到 ${target}，或安装后加入 PATH。`,
  );
}

/** 解析 ffmpeg；ffmpeg-static 随包分发，回退 PATH。 */
export function resolveFfmpeg(): string {
  const env = process.env.SUPERMAN_FFMPEG_BIN?.trim();
  const fromStatic = (() => {
    try {
      return require('ffmpeg-static') as string;
    } catch {
      return null;
    }
  })();
  return firstExisting([env, fromStatic ?? undefined, '/opt/homebrew/bin/ffmpeg']) ?? 'ffmpeg';
}
