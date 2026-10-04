/**
 * 服务运行配置（P2e-5 服务面板；TrendRadar 调度改造后）。
 *
 * - SAU 发布执行器仍是 keeper 模式：探活发现服务不可用且开关开启时自动拉起；
 * - TrendRadar 是一次性抓取程序（跑完即退），**不做 keeper**：改为由本配置的
 *   trendRadarRunMode/trendRadarRunTime 驱动「每天到点跑一次」，叠加面板上的
 *   「立即运行」手动触发；Python 本体永不自作主张地自动运行。
 *
 * 开关存 service_config 表（设置页热切换，免重启）；环境变量只在
 * DB 无值时作首次部署兜底。core 不 import dsh；进程拉起放 plugin/host
 * 层的 keeper/schedule tick（本文件只管配置读写与纯函数）。
 */
import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export type ServiceConfigKey = 'scheduler' | 'trendradar' | 'sau';

export type TrendRadarRunMode = 'off' | 'daily';

export interface ServicesConfig {
  /** 总开关：调度器全部周期任务（采集/热点同步/评论/洗稿/追踪）。 */
  schedulerEnabled: boolean;
  /** TrendRadar 定时运行：off=仅手动触发；daily=每天到点自动跑一次。 */
  trendRadarRunMode: TrendRadarRunMode;
  /** 每日运行时间（本地时区 HH:mm）。 */
  trendRadarRunTime: string;
  /** SAU 执行器 keeper：探活发现服务不可用自动拉起。 */
  sauKeeper: boolean;
}

export const DEFAULT_SERVICES_CONFIG: ServicesConfig = {
  schedulerEnabled: false,
  trendRadarRunMode: 'off',
  trendRadarRunTime: '09:00',
  sauKeeper: true,
};

const CONFIG_KEY = 'services';

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeRunTime(raw: unknown): string {
  return typeof raw === 'string' && HHMM_PATTERN.test(raw.trim())
    ? raw.trim()
    : DEFAULT_SERVICES_CONFIG.trendRadarRunTime;
}

/** 归一化任意输入为合法 ServicesConfig（保存与读取共用同一校验）。 */
export function normalizeServicesConfig(raw: unknown): ServicesConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    schedulerEnabled: source.schedulerEnabled === true,
    trendRadarRunMode: source.trendRadarRunMode === 'daily' ? 'daily' : 'off',
    trendRadarRunTime: normalizeRunTime(source.trendRadarRunTime),
    sauKeeper: source.sauKeeper !== false,
  };
}

/** 读服务配置原始值；无记录返回 null（调用方按 env/默认值兜底），表未建同样按 null。 */
export async function findServicesConfig(db: DbClient): Promise<ServicesConfig | null> {
  try {
    const { rows } = await db.query<{ value: unknown }>(
      `select value from service_config where key = $1 limit 1`,
      [CONFIG_KEY],
    );
    return rows[0] ? normalizeServicesConfig(rows[0].value) : null;
  } catch {
    return null;
  }
}

/** 读服务配置（无记录回退默认值；定时运行默认关，调度器默认关与历史行为一致）。 */
export async function getServicesConfig(db: DbClient): Promise<ServicesConfig> {
  return (await findServicesConfig(db)) ?? DEFAULT_SERVICES_CONFIG;
}

export async function saveServicesConfig(db: DbClient, config: ServicesConfig): Promise<void> {
  await db.query(
    `
      insert into service_config(key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update
        set value = $2, updated_at = now()
    `,
    [CONFIG_KEY, JSON.stringify(config)],
  );
}

/* ── TrendRadar 运行状态（key=trendradar_run）：定时去重与跑后同步的依据 ── */

export interface TrendRadarRunState {
  /** 最近一次抓取发起日（本地时区 YYYY-MM-DD；手动与定时都记）。 */
  lastRunDate: string | null;
  /** 最近一次跑后结构化同步完成日。 */
  lastSyncDate: string | null;
}

const RUN_STATE_KEY = 'trendradar_run';

/** 本地时区日期键 YYYY-MM-DD（去重与展示统一用它，不引时区库）。 */
export function todayLocalDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 本地时区时间键 HH:mm（与 trendRadarRunTime 同口径做字符串比较）。 */
export function nowLocalTimeString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

async function readRunState(db: DbClient): Promise<TrendRadarRunState> {
  try {
    const { rows } = await db.query<{ value: unknown }>(
      `select value from service_config where key = $1 limit 1`,
      [RUN_STATE_KEY],
    );
    const source = (rows[0]?.value ?? {}) as Record<string, unknown>;
    return {
      lastRunDate: typeof source.lastRunDate === 'string' ? source.lastRunDate : null,
      lastSyncDate: typeof source.lastSyncDate === 'string' ? source.lastSyncDate : null,
    };
  } catch {
    return { lastRunDate: null, lastSyncDate: null };
  }
}

async function patchRunState(db: DbClient, patch: Partial<TrendRadarRunState>): Promise<void> {
  const current = await readRunState(db);
  const next = { ...current, ...patch };
  await db.query(
    `
      insert into service_config(key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update
        set value = $2, updated_at = now()
    `,
    [RUN_STATE_KEY, JSON.stringify(next)],
  );
}

export async function getTrendRadarRunState(db: DbClient): Promise<TrendRadarRunState> {
  return readRunState(db);
}

/** 记「今天已发起抓取」（定时与手动触发共用，保证每天至多一轮自动抓取）。 */
export async function markTrendRadarRunDate(db: DbClient, date: string): Promise<void> {
  await patchRunState(db, { lastRunDate: date });
}

/** 记「今天已完成跑后同步」。 */
export async function markTrendRadarSyncDate(db: DbClient, date: string): Promise<void> {
  await patchRunState(db, { lastSyncDate: date });
}
