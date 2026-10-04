/**
 * Superman DSH 插件 · 服务 keeper + TrendRadar 定时任务（P2e-5，调度改造后）。
 *
 * - TrendRadar：一次性抓取程序（`python -m trendradar` 跑完即退），**不做
 *   死亡拉起**（一次性进程必然「死亡」，按常驻探活会变成每分钟重跑）。
 *   自动运行只走 `runTrendRadarScheduleTick`：设置项 trendRadarRunMode 驱动、
 *   每天到点至多一轮、跑完补一次结构化同步；手动走 /services/trendradar/restart。
 * - SAU 执行器：HTTP 健康探活（带 X-Sau-Token），不可用且开关开启 → spawn
 *   启动脚本（脚本内部 nohup 后台化，双保险日志落在 vendor logs/）。
 *
 * 层级说明：本文件属 plugin/host（要 spawn 进程）；配置读写复用 core 的
 * serviceConfig（core 只管 DB，不感知进程）。生命周期：子进程挂在 DSH 下，
 * DSH 退出时一并收掉——服务器部署后由 docker-compose 接管（K5 终态）。
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveSauConfig } from '@/core/platform-accounts/sau/sauProvider';
import {
  getServicesConfig,
  getTrendRadarRunState,
  markTrendRadarRunDate,
  markTrendRadarSyncDate,
  nowLocalTimeString,
  todayLocalDateString,
} from '@/core/services/serviceConfig';

type ScheduleDb = Parameters<typeof getServicesConfig>[0];

/** 与 core/trendradar/sync.ts 的 DEFAULT_TRENDRADAR_HOME 保持一致（env 可覆盖）。 */
const DEFAULT_TRENDRADAR_HOME = '/Users/wade/work-space/pa-chong-cai-ji/TrendRadar';

function trendRadarHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.TRENDRADAR_HOME?.trim() || DEFAULT_TRENDRADAR_HOME;
}

function trendRadarPidFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(trendRadarHome(env), 'output', 'trendradar.pid');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** TrendRadar 探活：读 pid 文件判断进程在不在（无 pid 文件 = 未运行）。 */
export function isTrendRadarAlive(env: NodeJS.ProcessEnv = process.env): { alive: boolean; pid: number | null } {
  try {
    const raw = readFileSync(trendRadarPidFile(env), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid) && pid > 0 && isPidAlive(pid)) return { alive: true, pid };
    return { alive: false, pid: null };
  } catch {
    return { alive: false, pid: null };
  }
}

/** TrendRadar 拉起：spawn 一次性抓取进程，pid 写回文件供探活。返回 spawn 是否成功。 */
export function spawnTrendRadar(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = trendRadarHome(env);
  const pythonBin = path.join(home, '.venv', 'bin', 'python');
  try {
    accessSync(pythonBin, constants.X_OK);
  } catch {
    return false; // venv 未部署，静默放弃（面板状态会显示未运行）
  }
  try {
    const child = spawn(pythonBin, ['-m', 'trendradar'], {
      cwd: home,
      stdio: 'ignore',
      detached: false,
    });
    child.on('error', () => { /* spawn 失败：定时任务下一轮再试 */ });
    child.unref();
    writeFileSync(trendRadarPidFile(env), String(child.pid ?? ''), 'utf8');
    return typeof child.pid === 'number';
  } catch {
    return false;
  }
}

/** SAU 执行器探活：带共享密钥请求健康端点（getValidAccounts 需 token）。 */
export async function isSauExecutorAlive(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const config = resolveSauConfig(env);
  if (!config.token) return false; // 未配密钥视为不可用（回调/探活都需要它）
  try {
    const res = await fetch(`${config.baseUrl}/getValidAccounts?type=1`, {
      headers: { 'x-sau-token': config.token },
      signal: AbortSignal.timeout(4_000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** SAU 执行器拉起：走启动脚本（脚本内部已处理 env/pid/日志，双进程模型）。 */
export function spawnSauExecutor(projectRoot: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const script = path.join(projectRoot, 'scripts', 'sau-executor.sh');
  try {
    accessSync(script, constants.X_OK);
  } catch {
    return false;
  }
  try {
    const child = spawn('bash', [script, 'start'], {
      cwd: projectRoot,
      stdio: 'ignore',
      detached: false,
      env: { ...process.env, ...env },
    });
    child.on('error', () => { /* 下轮再试 */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export interface KeeperProbeResult {
  sau: { alive: boolean; restarted: boolean };
}

/**
 * SAU keeper 单轮探活：开关开启且服务不可用 → 拉起。
 * 由调度器每 60s 调一次；也可由设置页「立即检查」手动触发。
 * （TrendRadar 不再走 keeper：一次性进程的自动运行见 runTrendRadarScheduleTick。）
 */
export async function runKeeperTick(input: {
  projectRoot: string;
  sauKeeper: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<KeeperProbeResult> {
  const env = input.env ?? process.env;

  const sauAliveBefore = await isSauExecutorAlive(env);
  let sauRestarted = false;
  if (!sauAliveBefore && input.sauKeeper) {
    sauRestarted = spawnSauExecutor(input.projectRoot, env);
  }

  return {
    sau: { alive: sauAliveBefore, restarted: sauRestarted },
  };
}

export interface TrendRadarScheduleTickResult {
  action: 'ran' | 'synced' | 'skipped';
  reason:
    | 'due'            // 到点拉起当日抓取
    | 'post_run_sync'  // 当日抓取已退出，补结构化同步
    | 'mode_off'       // 设置为仅手动
    | 'already_ran'    // 今天已跑过（且已同步）
    | 'running'        // 上一轮还在跑
    | 'not_due'        // 未到设定时间
    | 'spawn_failed';  // venv 缺失等拉起失败
  pid?: number | null;
}

/**
 * TrendRadar 定时任务单轮检查（宿主每 60s 调一次，独立于全局调度器开关）：
 *
 * 1. trendRadarRunMode=daily 且今天还没跑过、已到 trendRadarRunTime、当前没在跑
 *    → 拉起一次性抓取并记 lastRunDate（手动「立即运行」同样记，天然互斥去重）；
 * 2. 今天跑过且进程已退出、还没做结构化同步 → 逐活跃用户 runTrendRadarSync。
 */
export async function runTrendRadarScheduleTick(input: {
  db: ScheduleDb;
  env?: NodeJS.ProcessEnv;
}): Promise<TrendRadarScheduleTickResult> {
  const env = input.env ?? process.env;
  const config = await getServicesConfig(input.db);
  if (config.trendRadarRunMode !== 'daily') {
    return { action: 'skipped', reason: 'mode_off' };
  }

  const state = await getTrendRadarRunState(input.db);
  const today = todayLocalDateString();
  const alive = isTrendRadarAlive(env);

  if (state.lastRunDate !== today) {
    if (alive.alive) return { action: 'skipped', reason: 'running', pid: alive.pid };
    if (nowLocalTimeString() < config.trendRadarRunTime) {
      return { action: 'skipped', reason: 'not_due' };
    }
    if (!spawnTrendRadar(env)) return { action: 'skipped', reason: 'spawn_failed' };
    await markTrendRadarRunDate(input.db, today);
    return { action: 'ran', reason: 'due', pid: isTrendRadarAlive(env).pid };
  }

  if (state.lastSyncDate !== today && !alive.alive) {
    const [{ runTrendRadarSync }, { listUsers }] = await Promise.all([
      import('@/core/trendradar/sync'),
      import('@/core/auth/usersRepo'),
    ]);
    const users = await listUsers(input.db as never);
    for (const user of users.filter((u) => u.status === 'active')) {
      await runTrendRadarSync({ pool: input.db as never, userId: user.id }).catch(() => {
        /* 当日 SQLite 尚未生成等场景：留待下一轮 tick 重试 */
      });
    }
    await markTrendRadarSyncDate(input.db, today);
    return { action: 'synced', reason: 'post_run_sync' };
  }

  return { action: 'skipped', reason: alive.alive ? 'running' : 'already_ran', pid: alive.pid };
}
