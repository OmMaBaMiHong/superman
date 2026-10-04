/**
 * 服务运行配置与 keeper（P2e-5 服务面板）。
 *
 * 两个外部进程（TrendRadar 热榜源 / SAU 发布执行器）从「游离进程」变成
 * 「插件照看的子进程」：keeper 探活发现死亡且开关开启时自动拉起，
 * 电脑重启后只要 DSH 在跑，服务自动恢复——用户不再需要手工干预。
 *
 * 开关存 service_config 表（设置页热切换，免重启）；环境变量只在
 * DB 无值时作首次部署兜底。core 不 import dsh；进程拉起放 plugin/host
 * 层的 keeper（本文件只管配置读写与纯函数）。
 */
import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export type ServiceConfigKey = 'scheduler' | 'trendradar' | 'sau';

export interface ServicesConfig {
  /** 总开关：调度器全部周期任务（采集/热点同步/评论/洗稿/追踪）。 */
  schedulerEnabled: boolean;
  /** TrendRadar keeper：探活发现进程死亡自动拉起。 */
  trendRadarKeeper: boolean;
  /** SAU 执行器 keeper：探活发现服务不可用自动拉起。 */
  sauKeeper: boolean;
}

export const DEFAULT_SERVICES_CONFIG: ServicesConfig = {
  schedulerEnabled: false,
  trendRadarKeeper: true,
  sauKeeper: true,
};

const CONFIG_KEY = 'services';

function normalizeConfig(raw: unknown): ServicesConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    schedulerEnabled: source.schedulerEnabled === true,
    trendRadarKeeper: source.trendRadarKeeper !== false,
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
    return rows[0] ? normalizeConfig(rows[0].value) : null;
  } catch {
    return null;
  }
}

/** 读服务配置（无记录回退默认值；keeper 类默认开，调度器默认关与历史行为一致）。 */
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
