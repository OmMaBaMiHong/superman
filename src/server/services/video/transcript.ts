import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { saveTranscript } from './material';
import { buildDouyinCookieArgs } from './douyinCookies';

const execFileAsync = promisify(execFile);

// @whisper-cpp-node/core@0.2.0 的 exports 里 import 指向不存在的 dist/index.mjs（仅打包了 CJS index.js），
// 用 createRequire 走 CJS 加载以规避 ESM 解析失败。
const require = createRequire(import.meta.url);
const { createWhisperContext, transcribeAsync } = require('@whisper-cpp-node/core') as {
  createWhisperContext: typeof import('@whisper-cpp-node/core')['createWhisperContext'];
  transcribeAsync: typeof import('@whisper-cpp-node/core')['transcribeAsync'];
};

const YT_DLP_BIN = '/opt/homebrew/bin/yt-dlp';
const YT_DLP_BIN_FALLBACK = 'yt-dlp';
/** whisper.cpp GGML 模型文件路径（large-v3-turbo 量化版，中文识别与标点更佳） */
const WHISPER_MODEL_PATH = path.join(process.cwd(), 'models', 'whisper', 'ggml-large-v3-turbo-q5_0.bin');

/**
 * Whisper 转写引导提示词（initial_prompt）。
 * 注意：prompt 是"风格模仿"，必须传带标点的口语化示例，而不是"请加标点"这类指令，
 * 否则反而会导致中文输出丢失标点。
 */
const WHISPER_INITIAL_PROMPT = '你好，这是一段中文视频的语音转写。我记得，今天天气很好，我们一起去公园散散步吧。请问，你觉得这个方案怎么样？';

const TRANSCRIPT_DIR = path.join(process.cwd(), 'downloads', 'transcript_tmp');

export interface TranscriptResult {
  text: string;
  source: 'subtitle' | 'whisper';
  language?: string;
}

/**
 * 提取视频文案/字幕
 * 优先使用 yt-dlp 获取内嵌字幕，回退到 Whisper 语音识别
 */
export async function extractTranscript(url: string, articleId?: number, userId?: number, videoTitle?: string, provider?: string): Promise<TranscriptResult> {
  await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });

  // 1. 尝试获取字幕
  const subtitle = await tryGetSubtitles(url, userId);
  if (subtitle) {
    // 保存到数据库
    if (articleId && userId) {
      await saveTranscript({
        articleId, userId,
        videoUrl: url,
        videoTitle: videoTitle ?? '',
        provider: provider ?? '',
        text: subtitle.text,
        source: subtitle.source,
        language: subtitle.language,
      }).catch(() => {});
    }
    return subtitle;
  }

  // 2. 回退：下载音频 → Whisper 语音识别
  const whisperResult = await transcribeWithWhisper(url, userId);

  // 保存到数据库
  if (articleId && userId) {
    await saveTranscript({
      articleId, userId,
      videoUrl: url,
      videoTitle: videoTitle ?? '',
      provider: provider ?? '',
      text: whisperResult.text,
      source: whisperResult.source,
      language: whisperResult.language,
    }).catch(() => {});
  }

  return whisperResult;
}

/**
 * 尝试通过 yt-dlp 获取已有字幕
 */
async function tryGetSubtitles(url: string, userId?: number): Promise<TranscriptResult | null> {
  const bin = existsSync(YT_DLP_BIN) ? YT_DLP_BIN : YT_DLP_BIN_FALLBACK;
  const { args: cookieArgs, cleanup: cookieCleanup } = await buildDouyinCookieArgs(url, userId);

  try {
    // 先检查字幕信息
    const { stdout: infoJson } = await execFileAsync(bin, [
      '--dump-json',
      '--no-playlist',
      ...cookieArgs,
      url,
    ]);
    const info = JSON.parse(infoJson);

    const allCaps = { ...info.subtitles, ...info.automatic_captions };
    // 优先中文，其次英文，再取第一个
    const lang = allCaps.zh
      ? 'zh'
      : allCaps['zh-Hans']
        ? 'zh-Hans'
        : allCaps['zh-CN']
          ? 'zh-CN'
          : allCaps.en
            ? 'en'
            : Object.keys(allCaps)[0];

    if (!lang || !allCaps[lang]) return null;

    // 下载字幕
    const outputPath = path.join(TRANSCRIPT_DIR, 'subtitle');
    const { stdout: subFile } = await execFileAsync(bin, [
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', lang,
      '--convert-subs', 'vtt',
      '--skip-download',
      '--print', 'filename',
      '-o', outputPath,
      '--no-playlist',
      ...cookieArgs,
      url,
    ]);

    const vttPath = subFile.trim();
    if (!existsSync(vttPath)) return null;

    const vttContent = await fs.readFile(vttPath, 'utf-8');
    const text = parseVtt(vttContent);

    // 清理临时文件
    await fs.unlink(vttPath).catch(() => {});

    if (text.trim()) {
      return { text: text.trim(), source: 'subtitle', language: lang };
    }
  } catch {
    // 字幕获取失败，回退到 Whisper
  } finally {
    await cookieCleanup();
  }

  return null;
}

/**
 * 回退方案：下载音频 → Whisper 语音识别
 */
async function transcribeWithWhisper(url: string, userId?: number): Promise<TranscriptResult> {
  const bin = existsSync(YT_DLP_BIN) ? YT_DLP_BIN : YT_DLP_BIN_FALLBACK;
  const { args: cookieArgs, cleanup: cookieCleanup } = await buildDouyinCookieArgs(url, userId);

  await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });

  const audioPath = path.join(TRANSCRIPT_DIR, 'audio.mp3');
  const wavPath = path.join(TRANSCRIPT_DIR, 'audio.wav');

  try {
    // 1. 下载音频
    await execFileAsync(bin, [
      '-x',
      '--audio-format', 'mp3',
      '-o', audioPath,
      '--no-playlist',
      ...cookieArgs,
      url,
    ]);

    // 2. 用 ffmpeg 转成 whisper 需要的 16kHz 单声道 WAV
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', audioPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      wavPath,
    ]);

    // 3. Whisper 识别
    return await runWhisper(wavPath);
  } finally {
    await cookieCleanup();
    // 清理临时音频文件
    await fs.unlink(audioPath).catch(() => {});
    await fs.unlink(wavPath).catch(() => {});
    await cleanupTranscriptDir();
  }
}

/**
 * 本地视频文件文案提取（工作区上传的素材）。
 *
 * 与 `extractTranscript` 的区别：素材已在本地，无需 yt-dlp 下载，
 * 直接转 16kHz 单声道 WAV 后交给 Whisper 语音识别。
 */
export async function transcribeLocalVideo(filePath: string): Promise<TranscriptResult> {
  await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });

  const wavPath = path.join(TRANSCRIPT_DIR, 'local_audio.wav');

  try {
    // 用 ffmpeg 转成 whisper 需要的 16kHz 单声道 WAV
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', filePath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      wavPath,
    ]);

    return await runWhisper(wavPath);
  } finally {
    await fs.unlink(wavPath).catch(() => {});
    await cleanupTranscriptDir();
  }
}

/** 检查 Whisper 模型并把 WAV 交给 Whisper 识别 */
async function runWhisper(wavPath: string): Promise<TranscriptResult> {
  // 检查模型是否存在
  if (!existsSync(WHISPER_MODEL_PATH)) {
    throw new Error('Whisper 模型未安装，请先下载模型到 models/whisper/ggml-large-v3-turbo-q5_0.bin');
  }

  // 使用 whisper.cpp 语音识别
  const ctx = createWhisperContext({
    model: WHISPER_MODEL_PATH,
    use_gpu: true,
    no_prints: true,
  });

  try {
    const result = await transcribeAsync(ctx, {
      fname_inp: wavPath,
      language: 'zh',
      // 使用 beam search 而非贪心解码，中文输出才能保留标点
      beam_size: 5,
      best_of: 5,
      // 带标点的口语化示例，引导模型按中文习惯输出标点
      prompt: WHISPER_INITIAL_PROMPT,
      no_timestamps: true,
      n_threads: 4,
    });

    const text = result.segments.map(([, , segment]) => segment).join('').trim();
    return { text, source: 'whisper' };
  } finally {
    ctx.free();
  }
}

/**
 * 解析 VTT 字幕文件为纯文本
 */
function parseVtt(vtt: string): string {
  return vtt
    .replace(/^WEBVTT.*\n?/m, '')
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*\n?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^kind:.*\n?/m, '')
    .replace(/^language:.*\n?/m, '')
    .replace(/^\s*[\r\n]/gm, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 清理临时转录目录
 */
async function cleanupTranscriptDir() {
  try {
    const files = await fs.readdir(TRANSCRIPT_DIR);
    for (const file of files) {
      await fs.unlink(path.join(TRANSCRIPT_DIR, file)).catch(() => {});
    }
  } catch {
    // 忽略
  }
}