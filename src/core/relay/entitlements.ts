/**
 * 中转站会员权益（对标 Skoob packages/studio/src/api/membership.ts + free-plan.ts）。
 *
 * 模型：中转站拥有订阅；本插件在 relay_membership_group 表配置「分组 → 权益点」
 * 映射（默认 seed 两档：免费/会员），登录对账时拉生效订阅 → 按分组取权益并集
 * → 快照进 relay_membership_snapshot（5min TTL 代码层控制）。
 *
 * isPaid 纪律（照抄 Skoob）：免费档订阅不算付费会员——付费门（洗稿/媒体生成/
 * 知识库问答/中转站模型）必须看 is_paid 分组的权益。
 */
import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;
import { AppError } from '@/server/infra/http/errors';

export const ENTITLEMENTS = {
  'collect.use': '收藏与订阅采集',
  'trending.read': '热点雷达浏览',
  'rewrite.execute': 'AI 洗稿',
  'media.generate': '口播 / 漫剧生成',
  'knowledge.chat': '知识库问答',
  'models.relay': '中转站模型使用',
} as const;

export type Entitlement = keyof typeof ENTITLEMENTS;

/** 免费权益（不需要任何订阅）。 */
export const FREE_ENTITLEMENTS: readonly Entitlement[] = ['collect.use', 'trending.read'];

/** 会员快照 TTL：对账只发生在登录/手动同步/缓存过期后。 */
const SNAPSHOT_TTL_MS = 5 * 60_000;

export interface MembershipAccess {
  loggedIn: boolean;
  isMember: boolean;
  plan: string | null;
  expiresAt: string | null;
  entitlements: Entitlement[];
  subscriptions: RelaySubscriptionView[];
  stale: boolean;
}

export const NO_MEMBERSHIP: MembershipAccess = {
  loggedIn: false,
  isMember: false,
  plan: null,
  expiresAt: null,
  entitlements: [...FREE_ENTITLEMENTS],
  subscriptions: [],
  stale: false,
};

export interface RelaySubscriptionView {
  id: number | null;
  plan: string | null;
  groupId: number | null;
  status: string;
  expiresAt: string | null;
}

export interface RelaySubscriptionView {
  id: number | null;
  plan: string | null;
  groupId: number | null;
  status: string;
  expiresAt: string | null;
}

export interface MembershipSnapshot {
  userId: string;
  subscriptions: RelaySubscriptionView[];
  entitlements: Entitlement[];
  isMember: boolean;
  syncedAt: string;
}

/** 权益检查：登录后免费权益恒有；会员权益要求快照的 entitlements 含该点。 */
export function hasEntitlement(snapshot: MembershipSnapshot | null, point: Entitlement): boolean {
  if (FREE_ENTITLEMENTS.includes(point)) return true;
  if (!snapshot) return false;
  if (Date.now() - Date.parse(snapshot.syncedAt) > SNAPSHOT_TTL_MS) return false; // 过期快照不判会员权益
  return snapshot.entitlements.includes(point);
}

/** 快照是否已过期（面板据此提示「会员状态可能已变化，点同步刷新」）。 */
export function isSnapshotStale(snapshot: MembershipSnapshot): boolean {
  return Date.now() - Date.parse(snapshot.syncedAt) > SNAPSHOT_TTL_MS;
}

async function readSnapshot(db: DbClient, userId: string): Promise<MembershipSnapshot | null> {
  const { rows } = await db.query<{
    user_id: string;
    subscriptions: RelaySubscriptionView[];
    entitlements: string[];
    is_member: boolean;
    synced_at: string;
  }>(
    `select user_id, subscriptions, entitlements, is_member, synced_at from relay_membership_snapshot where user_id = $1 limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    subscriptions: Array.isArray(row.subscriptions) ? row.subscriptions : [],
    entitlements: (Array.isArray(row.entitlements) ? row.entitlements : []) as Entitlement[],
    isMember: row.is_member === true,
    syncedAt: row.synced_at,
  };
}

/**
 * 会员访问判定（本地快照，不出网）。快照缺失 → NO_MEMBERSHIP（未同步）。
 * 需要新鲜数据时调用方先跑 syncMembership。
 */
export async function getMembershipAccess(db: DbClient, userId: string): Promise<MembershipAccess> {
  const snapshot = await readSnapshot(db, userId);
  if (!snapshot) return NO_MEMBERSHIP;
  return {
    loggedIn: true,
    isMember: snapshot.isMember,
    plan: snapshot.subscriptions[0]?.plan ?? null,
    expiresAt: snapshot.subscriptions[0]?.expiresAt ?? null,
    entitlements: snapshot.entitlements,
    subscriptions: snapshot.subscriptions,
    stale: isSnapshotStale(snapshot),
  };
}

/** 权益不足的统一错误（sendError 按 AppError 映射 403；前端按 code=membership_required 引导授权/升级）。 */
export class MembershipRequiredError extends AppError {
  point: Entitlement;
  constructor(point: Entitlement) {
    super(`该功能需要会员权益：${ENTITLEMENTS[point]}`, 'membership_required', 403);
    this.point = point;
  }
}

/** 权益门槛检查：不满足直接抛 MembershipRequiredError（路由层转 403）。 */
export async function requireEntitled(
  db: DbClient,
  userId: string,
  point: Entitlement,
): Promise<MembershipSnapshot | null> {
  if (FREE_ENTITLEMENTS.includes(point)) return null;
  const snapshot = await readSnapshot(db, userId);
  if (!hasEntitlement(snapshot, point)) throw new MembershipRequiredError(point);
  return snapshot;
}
