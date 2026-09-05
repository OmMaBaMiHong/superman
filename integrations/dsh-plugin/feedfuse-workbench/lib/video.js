/**
 * feedfuse-workbench 自包含视频模块。
 *
 * 原插件调用 FeedFuse 后端 9559 的 /api/video/{download,transcript}，本模块把
 * 同样逻辑内联进 DSH 进程：用系统 yt-dlp 下载 + ffmpeg 归一化 + 字幕/Whisper 提取。
 * 所有临时文件落在插件私有 data 目录，不依赖外部服务。
 *
 * binaries 探测顺序：config 显式路径 > 常用 Homebrew 路径 > PATH 全局命令。
 * Whisper 模型：必须下载 GGML 文件放置于 <dataDir>/models/whisper/，否则提示引导。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join, extname, basename, dirname } from 'node:path'

const execFileAsync = promisify(execFile)

const HOMEBREW = '/opt/homebrew/bin'
const HOME_UTILS = process.env.HOME ? join(process.env.HOME, '.local', 'bin') : null

function resolveBin(candidates) {
  for (const c of candidates) {
    if (!c) continue
    if (c.includes('/')) {
      if (existsSync(c)) return c
    }
  }
  // 非绝对路径（如 'yt-dlp'）依赖 PATH，直接返回命中的命令名，或最后一个候选名。
  return candidates.find((c) => !!c && !c.includes('/')) ?? candidates.filter(Boolean).at(-1)
}

/** 探测 yt-dlp / ffmpeg / ffprobe 可执行文件路径。 */
function detectBinaries(config) {
  const ytDlp = resolveBin([
    config.ytDlpPath,
    join(HOMEBREW, 'yt-dlp'),
    HOME_UTILS ? join(HOME_UTILS, 'yt-dlp') : null,
    'yt-dlp',
  ])
  const ffmpeg = resolveBin([
    config.ffmpegPath,
    join(HOMEBREW, 'ffmpeg'),
    HOME_UTILS ? join(HOME_UTILS, 'ffmpeg') : null,
    'ffmpeg',
  ])
  const ffprobe = resolveBin([
    config.ffprobePath,
    join(HOMEBREW, 'ffprobe'),
    HOME_UTILS ? join(HOME_UTILS, 'ffprobe') : null,
    'ffprobe',
  ])
  const whisper = resolveBin([
    config.whisperPath,
    join(HOMEBREW, 'whisper-cli'),
    HOME_UTILS ? join(HOME_UTILS, 'whisper-cli') : null,
    'whisper-cli',
    'whisper-cpp',
  ])
  return { ytDlp, ffmpeg, ffprobe, whisper }
}

/** 发现 whisper 模型文件（<dataDir>/models/whisper/*.bin）。 */
function findWhisperModel(dataDir) {
  const dir = join(dataDir, 'models', 'whisper')
  if (!existsSync(dir)) return null
  const bins = readdirSync(dir).filter((f) => f.endsWith('.bin'))
  return bins.length ? join(dir, bins[0]) : null
}

/**
 * 资产自动安装（自包含部署）：
 * - yt-dlp / ffmpeg / ffprobe / whisper-cli 通过系统包管理器（brew/pip3/apt/dnf）安装；
 * - Whisper GGML 模型通过 HTTPS 直接拉取到 <dataDir>/models/whisper/。
 * 仅在 config.autoInstallAssets !== false 时启用（默认开启，契合「下载时自动装能力」）。
 */

async function commandExists(name) {
  return new Promise((resolve) => {
    execFile('which', [name], (err) => resolve(!err))
  })
}

/** 判断解析出的工具是否真正可用：绝对路径查文件，命令名查 PATH。 */
async function isBinaryUsable(value) {
  if (!value) return false
  if (value.includes('/')) return existsSync(value)
  return commandExists(value)
}

/** 探测一组工具的可用性，返回 { bins, missing }；needed ∈ 工具键名。 */
export async function ensureBinaries(config, needed) {
  const bins = detectBinaries(config)
  const missing = []
  for (const n of needed) {
    if (!(await isBinaryUsable(bins[n]))) missing.push(n)
  }
  return { bins, missing }
}

/** 每个缺失工具对应的包管理器安装命令（按序尝试，首个成功即止）。 */
const INSTALL_PLANS = {
  ytDlp: [
    { cmd: 'brew', args: ['install', '-q', 'yt-dlp'] },
    { cmd: 'pip3', args: ['install', '--user', '--quiet', 'yt-dlp'] },
    { cmd: 'apt-get', args: ['install', '-y', 'yt-dlp'] },
    { cmd: 'dnf', args: ['install', '-y', 'yt-dlp'] },
  ],
  ffmpeg: [
    { cmd: 'brew', args: ['install', '-q', 'ffmpeg'] },
    { cmd: 'apt-get', args: ['install', '-y', 'ffmpeg'] },
    { cmd: 'dnf', args: ['install', '-y', 'ffmpeg'] },
  ],
  whisper: [
    { cmd: 'brew', args: ['install', '-q', 'whisper-cpp'] },
    { cmd: 'apt-get', args: ['install', '-y', 'whisper-cpp'] },
  ],
}

/** 尝试安装缺失工具，返回 { installed, stillMissing }。 */
export async function installMissingAssets(config, missing) {
  const installed = []
  const stillMissing = []
  for (const n of missing) {
    if (n === 'ffprobe') continue // 随 ffmpeg 一起交付
    const plan = INSTALL_PLANS[n]
    if (!plan) { stillMissing.push(n); continue }
    let ok = false
    for (const step of plan) {
      try { await execFileAsync(step.cmd, step.args); ok = true; break } catch { /* 试下一个包管理器 */ }
    }
    if (ok) installed.push(n)
    else stillMissing.push(n)
  }
  if (missing.includes('ffprobe') && (await isBinaryUsable(detectBinaries(config).ffprobe))) installed.push('ffprobe')
  else if (missing.includes('ffprobe')) stillMissing.push('ffprobe')
  return { installed, stillMissing }
}

/**
 * 确保一组工具可用：缺且允许自动安装时先装再复检。
 * 返回 { bins, missing }；missing 为空即就绪。
 */
export async function ensureAssets(config, needed) {
  const { missing } = await ensureBinaries(config, needed)
  if (missing.length === 0 || config.autoInstallAssets === false) return { bins: detectBinaries(config), missing }
  const { stillMissing } = await installMissingAssets(config, missing)
  return { bins: detectBinaries(config), missing: stillMissing }
}

const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'

/** 拉取 Whisper GGML 模型（无则下载），返回模型文件路径。 */
export async function ensureWhisperModel(config) {
  const dataDir = config.dataDir || 'feedfuse-data'
  const loaded = findWhisperModel(dataDir)
  if (loaded) return loaded
  // 显式本地模型文件优先（用户已有 GGML 模型时不必下载）。
  if (config.whisperModelPath && existsSync(config.whisperModelPath)) return config.whisperModelPath
  if (config.autoInstallAssets === false) {
    throw new Error('未安装 Whisper 模型，且已关闭自动安装（config.autoInstallAssets=false）。请手动下载 GGML 模型放入 ' + join(dataDir, 'models', 'whisper') + '，或设置 config.whisperModelPath 指向本地模型文件')
  }
  const dir = join(dataDir, 'models', 'whisper')
  mkdirSync(dir, { recursive: true })
  const primary = config.whisperModelUrl || WHISPER_MODEL_URL
  // huggingface.co 在国内常不可达，先试同名镜像再退回原地址。
  const mirror = primary.replace('huggingface.co', 'hf-mirror.com')
  const candidates = [...new Set([mirror, primary])]
  const failures = []
  const { createWriteStream } = await import('node:fs')
  const { pipeline } = await import('node:stream/promises')
  for (const modelUrl of candidates) {
    const name = basename(new URL(modelUrl).pathname) || 'ggml-base.bin'
    const target = join(dir, name)
    try {
      const res = await fetch(modelUrl, { signal: AbortSignal.timeout(600_000) })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      // 流式落盘：模型上百 MB，不整块读进内存
      await pipeline(Readable.fromWeb(res.body), createWriteStream(target))
      if (!statSync(target).size) throw new Error('下载文件为空')
      return target
    } catch (e) {
      failures.push(`${modelUrl} → ${e instanceof Error ? e.message : String(e)}`)
      rmSync(target, { force: true })
    }
  }
  throw new Error('下载 Whisper 模型失败：' + failures.join('；'))
}

async function probeCodec(ffprobe, filePath) {
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ])
  return stdout.trim().toLowerCase()
}

async function ensureH264Compat(ffmpeg, filePath) {
  const codec = await probeCodec(filePath).catch(() => '')
  if (codec === 'h264' || codec === '') return filePath
  const target = join(dirname(filePath), `${basename(filePath, extname(filePath))}.compat.mp4`)
  await execFileAsync(ffmpeg, [
    '-y', '-i', filePath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    target,
  ])
  return target
}

async function ensureMp4Name(filePath) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.mp4') return filePath
  const cleaned = filePath
  const base = ext ? cleaned.slice(0, -ext.length) : cleaned
  const target = `${base}.mp4`
  return { target, cleaned }
}

/**
 * yt-dlp 的 `--cookies` 参数：抖音等平台需要浏览器 Cookie 才能拿到字幕/音频
 * （无 Cookie 时 yt-dlp 直接报 "Fresh cookies needed"）。Cookie 文件由调用方
 * 从插件已登录的 Chrome profile 导出（Netscape 格式），或来自 config.douyinCookie。
 * @param {object} config - 工具子配置（可能含 cookieFile）。
 * @returns {string[]} 追加参数（无可用文件时为空数组）。
 */
function cookieArgs(config) {
  const f = config && config.cookieFile
  return f && existsSync(f) ? ['--cookies', f] : []
}

/**
 * 用 yt-dlp 下载视频为 H.264 MP4，返回 { fileName, filePath, title, fileSize }。
 */
export async function downloadVideo(config, url) {
  const dataDir = config.dataDir || 'feedfuse-data'
  const dir = join(dataDir, 'downloads', 'video')
  mkdirSync(dir, { recursive: true })
  // 确保 yt-dlp/ffmpeg 可用（缺失时自动安装）
  const { bins, missing } = await ensureAssets(config, ['ytDlp', 'ffmpeg'])
  if (missing.length) throw new Error('缺少必需工具 ' + missing.join('、') + '，且自动安装未成功。请手动安装后重试。')
  const ytDlp = bins.ytDlp
  const ffmpeg = bins.ffmpeg
  const cookies = cookieArgs(config)

  const template = join(dir, '%(title)s.%(ext)s')
  // 先获取预计文件名
  const { stdout: filenameOut } = await execFileAsync(ytDlp, ['--print', 'filename', '-o', template, '--no-playlist', ...cookies, url]).catch(() => ({ stdout: '' }))
  let expected = filenameOut ? filenameOut.trim() : ''

  let realPath = null
  if (expected && existsSync(expected)) {
    realPath = expected
  }
  if (!realPath) {
    const before = new Set(existsSync(dir) ? readdirSync(dir) : [])
    await execFileAsync(ytDlp, [
      '-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio/best[ext=mp4]/best',
      '-o', template, '--no-playlist', '--no-progress', ...cookies, url,
    ])
    const after = existsSync(dir) ? readdirSync(dir) : []
    const fresh = after.filter((f) => !before.has(f)).map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime)
    if (!fresh.length) throw new Error('下载失败：未找到下载文件')
    realPath = join(dir, fresh[0].name)
  }

  // 归一化并确保 .mp4
  const h264 = await ensureH264Compat(ffmpeg, realPath)
  const nameRes = await ensureMp4Name(h264)
  if (nameRes.cleaned !== nameRes.target) {
    const { rename } = await import('node:fs/promises')
    await rename(nameRes.cleaned, nameRes.target).catch(() => {})
  }
  const filePath = nameRes.target
  const fileName = basename(filePath)
  const title = fileName.replace(/\.compat\.mp4$/, '').replace(/\.[^.]+$/, '')
  return { fileName, filePath, title, fileSize: statSync(filePath).size }
}

/** 提取视频文案：优先 yt-dlp 字幕，回退 Whisper 语音识别。返回 { text, source }。 */
export async function extractTranscript(config, url, videoTitle) {
  const dataDir = config.dataDir || 'feedfuse-data'
  const tmpDir = join(dataDir, 'transcript_tmp')
  mkdirSync(tmpDir, { recursive: true })
  // 确保 yt-dlp/ffmpeg/whisper 可用（缺失时自动安装）
  const { bins, missing } = await ensureAssets(config, ['ytDlp', 'ffmpeg', 'whisper'])
  if (missing.length) throw new Error('缺少必需工具 ' + missing.join('、') + '，且自动安装未成功。请手动安装后重试。')
  const ytDlp = bins.ytDlp

  // 1. 字幕
  const sub = await trySubtitles(ytDlp, tmpDir, url, config)
  if (sub.text) return sub

  // 2. Whisper 语音识别
  const whisperResult = await transcribeWithWhisper(config, bins, tmpDir, url)
  return whisperResult
}

async function trySubtitles(ytDlp, tmpDir, url, config) {
  const cookies = cookieArgs(config)
  try {
    const { stdout: infoJson } = await execFileAsync(ytDlp, ['--dump-json', '--no-playlist', ...cookies, url])
    const info = JSON.parse(infoJson)
    const caps = { ...info.subtitles, ...info.automatic_captions }
    const lang = caps.zh ? 'zh' : caps['zh-Hans'] ? 'zh-Hans' : caps['zh-CN'] ? 'zh-CN' : caps.en ? 'en' : Object.keys(caps)[0]
    if (!lang || !caps[lang]) return { text: '', source: null }

    const outTemplate = join(tmpDir, 'subtitle')
    const { stdout: subFile } = await execFileAsync(ytDlp, [
      '--write-subs', '--write-auto-subs', '--sub-langs', lang, '--convert-subs', 'vtt',
      '--skip-download', '--print', 'filename', '-o', outTemplate, '--no-playlist', ...cookies, url,
    ])
    const vttPath = subFile.trim()
    if (!existsSync(vttPath)) return { text: '', source: null }
    const { readFile, unlink } = await import('node:fs/promises')
    const vtt = await readFile(vttPath, 'utf8')
    await unlink(vttPath).catch(() => {})
    const text = parseVtt(vtt)
    if (!text) return { text: '', source: null }
    return { text, source: 'subtitle', language: lang }
  } catch {
    return { text: '', source: null }
  }
}

async function transcribeWithWhisper(config, bins, tmpDir, url) {
  const model = await ensureWhisperModel(config)
  const audio = join(tmpDir, 'audio.mp3')
  const wav = join(tmpDir, 'audio.wav')

  await execFileAsync(bins.ytDlp, ['-x', '--audio-format', 'mp3', '-o', audio, '--no-playlist', ...cookieArgs(config), url])
  await execFileAsync(bins.ffmpeg, ['-y', '-i', audio, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  const text = await runWhisper(bins.whisper, model, wav)
  return { text, source: 'whisper' }
}

async function runWhisper(cli, model, wavPath) {
  if (!cli || !cli.includes('/')) throw new Error('未找到 whisper 可执行文件（whisper-cli / whisper-cpp），无法语音识别')
  const { stdout } = await execFileAsync(cli, ['-m', model, '-f', wavPath, '-l', 'zh', '-nt', '--no-timestamps'])
  return stdout.trim()
}

function parseVtt(vtt) {
  return vtt
    .replace(/^WEBVTT.*\n?/m, '')
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*\n?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^kind:.*\n?/m, '')
    .replace(/^language:.*\n?/m, '')
    .replace(/^\s*[\r\n]/gm, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function binariesStatus(config) {
  const { ytDlp, ffmpeg, ffprobe, whisper } = detectBinaries(config)
  const dataDir = config.dataDir || 'feedfuse-data'
  return {
    ytDlp,
    ffmpeg,
    ffprobe,
    whisper,
    whisperModel: findWhisperModel(dataDir) || null,
    autoInstall: config.autoInstallAssets !== false,
  }
}