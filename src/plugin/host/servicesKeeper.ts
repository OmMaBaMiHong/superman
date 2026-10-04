/**
 * Superman DSH 插件 · 服务 keeper（P2e-5）。
 *
 * 两个外部进程的「照看者」：探活发现死亡且开关开启时自动拉起——
 * 电脑重启后只要 DSH 在跑，TrendRadar/SAU 执行器自动恢复，用户无需手工干预。
 *
 * - TrendRadar：pid 文件探活（process.kill(pid,0)），死亡 → spawn `-m trendradar`
 *   （常驻型，内部按自身 config 周期跑，不做一次性化以尊重上游、不fork）；
 * - SAU 执行器：HTTP 健康探活（带 X-Sau-Token），不可用 → spawn 启动脚本
 *   （脚本内部 nohup 后台化，双保险日志落在 vendor logs/）。
 *
 * 层级说明：本文件属 plugin/host（要 spawn 进程）；配置读写复用 core 的
 * serviceConfig（core 只管 DB，不感知进程）。生命周期：子进程挂在 DSH 下，
 * DSH 退出时一并收掉——服务器部署后由 docker-compose 接管（K5 终态）。
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveSauConfig } from '@/core/platform-accounts/sau/sauProvider';

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

/** TrendRadar 拉起：spawn 常驻进程，pid 写回文件供下次探活。返回 spawn 是否成功。 */
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
    child.on('error', () => { /* spawn 失败：keeper 下轮再试 */ });
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
  trendRadar: { alive: boolean; pid: number | null; restarted: boolean };
  sau: { alive: boolean; restarted: boolean };
}

/**
 * keeper 单轮探活：开关开启且进程死亡 → 拉起。
 * 由调度器每 60s 调一次；也可由设置页「立即检查」手动触发。
 */
export async function runKeeperTick(input: {
  projectRoot: string;
  trendRadarKeeper: boolean;
  sauKeeper: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<KeeperProbeResult> {
  const env = input.env ?? process.env;

  const trendRadarBefore = isTrendRadarAlive(env);
  let trendRadarRestarted = false;
  if (!trendRadarBefore.alive && input.trendRadarKeeper) {
    trendRadarRestarted = spawnTrendRadar(env);
  }

  const sauAliveBefore = await isSauExecutorAlive(env);
  let sauRestarted = false;
  if (!sauAliveBefore && input.sauKeeper) {
    sauRestarted = spawnSauExecutor(input.projectRoot, env);
  }

  return {
    trendRadar: { alive: trendRadarBefore.alive, pid: trendRadarBefore.pid, restarted: trendRadarRestarted },
    sau: { alive: sauAliveBefore, restarted: sauRestarted },
  };
}
