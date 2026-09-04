/**
 * 抖音数据服务 · douyin-cli 子进程执行器
 *
 * 「一键刷新」抓取评论与「在线回复」都是写操作，必须通过 douyin-cli 的油猴脚本
 * （Tampermonkey）+ Bridge Server 在浏览器里完成。这里用 spawn 调 douyin-cli 的
 * cli.js 命令，把结果回传给前端。
 *
 * 运行前提（由错误信息引导用户）：
 * 1. douyin-cli 的 Bridge Server 已启动（node server.js，端口 19422）；
 * 2. 浏览器已安装油猴脚本 scripts/douyin.user.js；
 * 3. 浏览器已打开 douyin.com 页面并保持登录态。
 */

import { spawn } from 'child_process';
import path from 'path';
import { getServerEnv } from '@/server/infra/env';
import { AppError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import {
  getAiApiKey,
  getUiSettings,
} from '@/server/domains/settings/repositories/settingsRepo';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';

const DOUYIN_CLI_DIR = '/Users/wade/.openclaw/douyin-cli';
const DOUYIN_CLI = path.join(DOUYIN_CLI_DIR, 'cli.js');
const SCHEMA = process.env.DOUYIN_SCHEMA || 'douyin';
/** douyin-cli Bridge Server 默认端口 */
const BRIDGE_STATUS_URL = 'http://127.0.0.1:19422/api/status';

/** 抓取超时：get 需要滚动加载评论，放宽到 180s */
const GET_TIMEOUT_MS = 180_000;
/** 回复超时：单次发布较快，60s */
const POST_TIMEOUT_MS = 60_000;
/** 作品列表超时：my/user 需调接口取一页作品，60s 足够 */
const LIST_TIMEOUT_MS = 60_000;
/** campaign 常规命令超时（list/create/status/stop/pause/resume/run --daemon） */
const CAMPAIGN_TIMEOUT_MS = 60_000;
/** campaign plan 超时：要逐个视频拉评论 + LLM 生成，放宽到 5 分钟 */
const CAMPAIGN_PLAN_TIMEOUT_MS = 300_000;
/** Bridge 连接预检超时：无浏览器连接时快速失败，避免前端无限转圈 */
const BRIDGE_PROBE_TIMEOUT_MS = 3_000;

export class DouyinCliError extends AppError {
  constructor(message: string) {
    super(message, 'douyin_cli_error', 502);
    this.name = 'DouyinCliError';
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 运行中的任务去重锁（key: 命令签名），避免重复触发同一个抓取/回复 */
const inFlight = new Map<string, Promise<RunResult>>();

function runCli(args: string[], timeoutMs: number, extraEnv?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const { DATABASE_URL } = getServerEnv();
    const child = spawn(process.execPath, [DOUYIN_CLI, ...args], {
      cwd: DOUYIN_CLI_DIR,
      env: {
        ...process.env,
        DATABASE_URL,
        DOUYIN_SCHEMA: SCHEMA,
        DOUYIN_DEBUG: process.env.DOUYIN_DEBUG || '',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new DouyinCliError(`无法启动 douyin-cli（${err.message}）`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** 解析 cli.js 错误输出，转成面向用户的友好提示 */
function toUserError(stderr: string, fallback: string): DouyinCliError {
  const s = stderr || '';
  if (s.includes('Bridge Server 未启动') || s.includes('ECONNREFUSED')) {
    return new DouyinCliError('Bridge Server 未启动。请先启动 douyin-cli 的 `node server.js`，并在浏览器打开抖音页面（需登录 + 安装油猴脚本）。');
  }
  if (s.includes('认证失败') || s.includes('Unauthorized')) {
    return new DouyinCliError('Bridge 认证失败，请检查 douyin-cli 的 config.json 中 bridge.token 配置。');
  }
  if (s.includes('风控') || s.includes('status_code')) {
    return new DouyinCliError('评论可能被风控拦截，请稍后重试或更换内容。');
  }
  const hint = s.replace(/^错误:\s*/, '').trim();
  return new DouyinCliError(hint || fallback);
}

/**
 * 查询 Bridge Server 连接状态（供前端展示「浏览器是否在线」）。
 * Bridge 未启动 / 无连接时不抛错，返回 { connected: false }。
 */
export async function getBridgeStatus(): Promise<{
  connected: boolean;
  connections: number;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_PROBE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(BRIDGE_STATUS_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const data = (await res.json().catch(() => null)) as { totalConnections?: number } | null;
    const connections = Number(data?.totalConnections ?? 0);
    return { connected: connections > 0, connections };
  } catch {
    return { connected: false, connections: 0, error: 'Bridge Server 未启动' };
  }
}

/**
 * 预检 Bridge 是否有浏览器连接（油猴脚本在线）。
 * 无连接时立即抛错，避免 spawn 出来的 douyin-cli 命令在无浏览器时挂起 60-180s，
 * 导致前端「抓评论 / 拉作品 / 回复」一直转圈。
 */
async function assertBridgeConnected(): Promise<void> {
  const { connected } = await getBridgeStatus();
  if (!connected) {
    throw new DouyinCliError(
      '浏览器未连接油猴脚本。请打开抖音页面并保持登录（确认右上角油猴脚本已运行），再重试。',
    );
  }
}

/**
 * 抓取某视频的评论（增量 --new）。
 * 同 awemeId 并发去重；返回本次抓到的评论数。
 */
export async function refreshComments(awemeId: string): Promise<{ count: number }> {
  if (!/^\d+$/.test(awemeId)) {
    throw new DouyinCliError('视频 ID（aweme_id）必须是数字串');
  }
  await assertBridgeConnected();
  const key = `get:${awemeId}`;
  const existing = inFlight.get(key);
  const run = existing ?? runCli(['get', awemeId, '--new'], GET_TIMEOUT_MS);
  inFlight.set(key, run);
  try {
    const result = await run;
    if (result.code !== 0 || !result.stdout.trim()) {
      throw toUserError(result.stderr, '抓取评论失败，请确认浏览器端油猴脚本已连接。');
    }
    let count = 0;
    try {
      const parsed = JSON.parse(result.stdout);
      count = Array.isArray(parsed) ? parsed.length : Number(parsed?.length) || 0;
    } catch {
      /* 输出非 JSON 时不强解析 */
    }
    return { count };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * 在线回复某条评论（--reply-to <cid>）。
 * 同 cid 并发去重；返回发布结果。
 */
export async function replyComment(input: {
  awemeId: string;
  cid: string;
  text: string;
}): Promise<{ cid: string; text: string }> {
  const { awemeId, cid, text } = input;
  if (!/^\d+$/.test(awemeId) || !/^\d+$/.test(cid)) {
    throw new DouyinCliError('视频 ID 或评论 ID 格式不正确');
  }
  const cleanText = String(text).trim();
  if (!cleanText) {
    throw new DouyinCliError('回复内容不能为空');
  }
  if (cleanText.length > 2000) {
    throw new DouyinCliError('回复内容过长（最多 2000 字）');
  }
  await assertBridgeConnected();
  const key = `post:${cid}`;
  const existing = inFlight.get(key);
  const run = existing ?? runCli(['post', awemeId, cleanText, '--reply-to', cid], POST_TIMEOUT_MS);
  inFlight.set(key, run);
  try {
    const result = await run;
    if (result.code !== 0 || !result.stdout.trim()) {
      throw toUserError(result.stderr, '发布回复失败，请确认浏览器端油猴脚本已连接。');
    }
    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed?.status === 'published') {
        return { cid: String(parsed.cid || ''), text: String(parsed.text || cleanText) };
      }
      throw toUserError(result.stderr, '发布回复失败，抖音未返回成功结果。');
    } catch (err) {
      if (err instanceof DouyinCliError) throw err;
      throw toUserError(result.stderr, '发布回复失败，响应解析异常。');
    }
  } finally {
    inFlight.delete(key);
  }
}

/** 单个作品（my/user 命令返回的 item 展开成统一结构） */
export interface DouyinWork {
  awemeId: string;
  title: string;
  time: number;
  duration: number;
  stats: {
    plays: number;
    likes: number;
    comments: number;
    shares: number;
    collects: number;
  };
  cover: string;
}

/** 作者信息（user 命令返回；my 命令也可能带） */
export interface DouyinAuthor {
  uid: string;
  secUid: string;
  nickname: string;
}

/** 解析 my/user 命令的 stdout 为 { user, items } */
function parseWorkList(stdout: string, isUserCmd: boolean): {
  user?: DouyinAuthor;
  items: DouyinWork[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new DouyinCliError('命令返回非 JSON 数据，请检查 douyin-cli 输出。');
  }
  const obj = (parsed ?? {}) as {
    user?: { uid?: string; sec_uid?: string; nickname?: string };
    aweme_list?: Array<{
      aweme_id?: string;
      desc?: string;
      time?: number;
      duration?: number;
      stats?: { plays?: number; likes?: number; comments?: number; shares?: number; collects?: number };
      cover?: string;
    }>;
  };
  const items: DouyinWork[] = (obj.aweme_list || []).map((a) => ({
    awemeId: String(a.aweme_id ?? ''),
    title: String(a.desc ?? ''),
    time: Number(a.time ?? 0),
    duration: Number(a.duration ?? 0),
    stats: {
      plays: Number(a.stats?.plays ?? 0),
      likes: Number(a.stats?.likes ?? 0),
      comments: Number(a.stats?.comments ?? 0),
      shares: Number(a.stats?.shares ?? 0),
      collects: Number(a.stats?.collects ?? 0),
    },
    cover: String(a.cover ?? ''),
  }));

  const user = isUserCmd
    ? {
        uid: String(obj.user?.uid ?? ''),
        secUid: String(obj.user?.sec_uid ?? ''),
        nickname: String(obj.user?.nickname ?? ''),
      }
    : undefined;

  return { user, items };
}

/** 统一校验命令输出并转友好错误 */
function assertCliOk(result: RunResult, fallback: string): void {
  if (result.code !== 0 || !result.stdout.trim()) {
    throw toUserError(result.stderr, fallback);
  }
}

/**
 * 拉取「我的作品」列表（douyin-cli my 命令）。
 * 通过油猴脚本从浏览器当前登录账号获取作品，并落库到 douyin.videos（is_mine=1）。
 * 返回作品列表（含播放/点赞/评论/分享/收藏统计）。
 */
export async function fetchMyVideos(count = 20): Promise<{ items: DouyinWork[] }> {
  await assertBridgeConnected();
  const key = `my:${count}`;
  const existing = inFlight.get(key);
  const run = existing ?? runCli(['my', '--count', String(count)], LIST_TIMEOUT_MS);
  inFlight.set(key, run);
  try {
    const result = await run;
    assertCliOk(result, '拉取我的作品失败，请确认浏览器端油猴脚本已连接（抖音页面保持登录）。');
    const { items } = parseWorkList(result.stdout, false);
    return { items };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * 拉取指定用户的作品列表（douyin-cli user 命令）。
 * 支持传入纯 sec_user_id 或完整用户主页 URL（https://www.douyin.com/user/<sec_uid>）。
 * 作品落库到 douyin.videos（is_mine=0，记录 author_uid / 作者昵称）。
 */
export async function fetchUserVideos(
  target: string,
  count = 18,
): Promise<{ user: DouyinAuthor; items: DouyinWork[] }> {
  const t = String(target).trim();
  if (!t) {
    throw new DouyinCliError('请输入 sec_user_id 或用户主页 URL。');
  }
  await assertBridgeConnected();
  const key = `user:${t}`;
  const existing = inFlight.get(key);
  const run = existing ?? runCli(['user', t, '--count', String(count)], LIST_TIMEOUT_MS);
  inFlight.set(key, run);
  try {
    const result = await run;
    assertCliOk(result, '拉取用户作品失败，请确认浏览器端油猴脚本已连接（抖音页面保持登录）。');
    const { user, items } = parseWorkList(result.stdout, true);
    return { user: user ?? { uid: '', secUid: '', nickname: '' }, items };
  } finally {
    inFlight.delete(key);
  }
}

/* ──────────────── 自动回帖（campaign） ──────────────── */

/**
 * 读取 FeedFuse 全局 AI 模型配置，映射为 douyin-cli LLM 客户端的环境变量。
 * douyin-cli 的 lib/llm.js 优先读环境变量 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL，
 * 因此把「设置中心 → AI 配置」里填好的模型注入子进程即可，无需单独配 key。
 */
async function resolveLlmEnv(): Promise<Record<string, string>> {
  const pool = getPool();
  const [uiSettings, aiApiKey] = await Promise.all([
    getUiSettings(pool),
    getAiApiKey(pool),
  ]);
  const config = resolveSharedAiConfig({
    settings: normalizePersistedSettings(uiSettings),
    aiApiKey,
  });
  const env: Record<string, string> = {};
  if (config.apiKey) env.OPENAI_API_KEY = config.apiKey;
  if (config.apiBaseUrl) env.OPENAI_BASE_URL = config.apiBaseUrl;
  if (config.model) env.OPENAI_MODEL = config.model;
  return env;
}

/** 统一校验 campaign 命令输出并转 JSON；失败转友好错误 */
function parseCampaignJson<T>(result: RunResult, fallback: string): T {
  if (result.code !== 0 || !result.stdout.trim()) {
    throw toUserError(result.stderr, fallback);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new DouyinCliError(`${fallback}（返回非 JSON 数据）`);
  }
}

/** 推广活动 */
export interface DouyinCampaign {
  id: number;
  platform: string;
  name: string;
  goal: string | null;
  template: unknown;
  videos: string[];
  filters: { minPriority?: number } | null;
  dailyQuota: number;
  perUserQuota: number;
  status: 'draft' | 'running' | 'paused' | 'done';
  startedAt: number | null;
  stats: Record<string, unknown> | null;
}

/** 创建活动（douyin-cli campaign create） */
export async function createCampaign(input: {
  name: string;
  goal?: string | null;
  videos?: string[];
  dailyQuota?: number;
  minPriority?: number;
}): Promise<DouyinCampaign> {
  const { name, goal, videos, dailyQuota = 50, minPriority = 0 } = input;
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new DouyinCliError('活动名称不能为空');
  const args = ['campaign', 'create', '--name', cleanName];
  if (goal && String(goal).trim()) args.push('--goal', String(goal).trim());
  if (videos && videos.length) args.push('--videos', videos.join(','));
  args.push('--daily-quota', String(dailyQuota));
  args.push('--min-priority', String(minPriority));
  const result = await runCli(args, CAMPAIGN_TIMEOUT_MS);
  return parseCampaignJson<DouyinCampaign>(result, '创建自动回帖活动失败。');
}

/**
 * 预生成回复任务（douyin-cli campaign plan）。
 * 逐个视频拉评论（需浏览器在线）→ 用全局模型生成回复草稿入 task（不发送）。
 */
export async function planCampaign(id: number): Promise<{
  campaign_id: number;
  videos: number;
  comments_seen: number;
  inserted: number;
  skipped: number;
}> {
  await assertBridgeConnected();
  const result = await runCli(['campaign', 'plan', String(id)], CAMPAIGN_PLAN_TIMEOUT_MS, await resolveLlmEnv());
  return parseCampaignJson(result, '预生成回复失败，请确认浏览器在线且全局 AI 模型已配置。');
}

/**
 * 启动后台自动回帖（douyin-cli campaign run --daemon）。
 * 主进程立即返回；daemon 继承含 LLM 配置的 env 持续消费 pending 任务。
 */
export async function runCampaign(id: number): Promise<{
  daemon: boolean;
  campaign_id: number;
  pid: number;
  log: string;
}> {
  await assertBridgeConnected();
  const result = await runCli(['campaign', 'run', String(id), '--daemon'], CAMPAIGN_TIMEOUT_MS, await resolveLlmEnv());
  return parseCampaignJson(result, '启动自动回帖失败，请确认浏览器在线。');
}

/** 停止活动（结束 daemon 进程） */
export async function stopCampaign(id: number): Promise<{ stopped: boolean; campaign_id: number; pid: number | null }> {
  const result = await runCli(['campaign', 'stop', String(id)], CAMPAIGN_TIMEOUT_MS);
  return parseCampaignJson(result, '停止活动失败。');
}

/** 暂停 / 恢复活动状态机（不结束进程） */
export async function pauseCampaign(id: number): Promise<DouyinCampaign> {
  const result = await runCli(['campaign', 'pause', String(id)], CAMPAIGN_TIMEOUT_MS);
  return parseCampaignJson(result, '暂停活动失败。');
}

export async function resumeCampaign(id: number): Promise<DouyinCampaign> {
  const result = await runCli(['campaign', 'resume', String(id)], CAMPAIGN_TIMEOUT_MS);
  return parseCampaignJson(result, '恢复活动失败。');
}
