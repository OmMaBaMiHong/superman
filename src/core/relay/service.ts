/**
 * 中转站授权与会员同步服务（P2e-6 relay 一期）。
 *
 * 登录：账密直连中转站 auth/login（Skoob 主通路）→ token secretBox 加密落
 * relay_auth（明文不出函数，面板只回显尾 4 位）；OAuth 授权登录二期补。
 * 对账（syncMembership）：登录成功/手动同步/快照过期后跑——拉生效订阅 →
 * 按 relay_membership_group 映射权益并集 → 快照落库（中转站是唯一源头，本地是镜像）。
 */
import { sealRelayToken, openRelayToken, listRelayKeys, listActiveSubscriptions, type RelayEndpointConfig, type RelayKey } from './client.js';
import type { RelaySubscriptionView } from './entitlements.js';
import { getServicesConfig } from '@/core/services/serviceConfig';
import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export interface RelayRuntimeConfig extends RelayEndpointConfig {
  defaultModel: string;
}

/** 中转站端点与默认模型：service_config key='relay'，设置页可编辑（可配置可修改）。 */
export async function getRelayRuntimeConfig(db: DbClient): Promise<RelayRuntimeConfig> {
  const defaults = { ...resolveDefaults() };
  try {
    const { rows } = await db.query<{ value: Record<string, unknown> }>(
      `select value from service_config where key = 'relay' limit 1`,
    );
    const raw = rows[0]?.value ?? {};
    return {
      apiUrl: typeof raw.apiUrl === 'string' && raw.apiUrl.trim() ? raw.apiUrl.replace(/\/+$/, '') : defaults.apiUrl,
      llmBaseUrl: typeof raw.llmBaseUrl === 'string' && raw.llmBaseUrl.trim() ? raw.llmBaseUrl.replace(/\/+$/, '') : defaults.llmBaseUrl,
      defaultModel: typeof raw.defaultModel === 'string' && raw.defaultModel.trim() ? raw.defaultModel : defaults.defaultModel,
    };
  } catch {
    return defaults;
  }
}

function resolveDefaults(): RelayRuntimeConfig {
  // 与 client.resolveRelayEndpoints 同默认；env 可覆盖（首次部署免配置）
  const endpoints = {
    apiUrl: (process.env.RELAY_API_URL ?? 'https://lai.gaotk.com').replace(/\/+$/, ''),
    llmBaseUrl: (process.env.RELAY_LLM_BASE_URL ?? 'https://lai.gaotk.com/v1').replace(/\/+$/, ''),
  };
  return { ...endpoints, defaultModel: process.env.RELAY_DEFAULT_MODEL?.trim() || 'deepseek-chat' };
}

export async function saveRelayRuntimeConfig(db: DbClient, input: Partial<RelayRuntimeConfig>): Promise<RelayRuntimeConfig> {
  const current = await getRelayRuntimeConfig(db);
  const next = { ...current, ...input };
  await db.query(
    `
      insert into service_config(key, value, updated_at)
      values ('relay', $1, now())
      on conflict (key) do update set value = $1, updated_at = now()
    `,
    [JSON.stringify(next)],
  );
  return next;
}

export interface RelayAuthRow {
  userId: string;
  accessTokenSealed: string;
  tokenMasked: string;
  user: Record<string, unknown> | null;
  selectedKeyId: string;
  selectedKeyLast4: string;
  selectedModel: string;
}

async function readRelayAuth(db: DbClient, userId: string): Promise<RelayAuthRow | null> {
  const { rows } = await db.query<{
    user_id: string;
    access_token_encrypted: string;
    token_masked: string;
    user_json: Record<string, unknown>;
    selected_key_id: string;
    selected_key_last4: string;
    selected_model: string;
  }>(
    `select user_id, access_token_encrypted, token_masked, user_json, selected_key_id, selected_key_last4, selected_model
     from relay_auth where user_id = $1 limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    accessTokenSealed: row.access_token_encrypted,
    tokenMasked: row.token_masked,
    user: row.user_json ?? null,
    selectedKeyId: row.selected_key_id,
    selectedKeyLast4: row.selected_key_last4,
    selectedModel: row.selected_model,
  };
}

export interface RelayStatus {
  loggedIn: boolean;
  user: Record<string, unknown> | null;
  tokenMasked: string | null;
  isMember: boolean;
  plan: string | null;
  expiresAt: string | null;
  entitlements: string[];
  subscriptions: RelaySubscriptionView[];
  keys: Array<{ id: string; name: string; last4: string; status: string; groupName: string | null; selected: boolean }>;
  selectedModel: string;
  endpoints: RelayEndpointConfig;
}

/** 面板状态（登录态/会员/Key 脱敏列表/选中模型/端点配置）。 */
export async function getRelayStatus(db: DbClient, userId: string): Promise<RelayStatus> {
  const endpoints = await getRelayRuntimeConfig(db);
  const auth = await readRelayAuth(db, userId);
  const { getMembershipAccess } = await import('./entitlements.js');
  const membership = await getMembershipAccess(db, userId);

  let keys: RelayStatus['keys'] = [];
  if (auth) {
    const token = await openRelayToken(db, auth.accessTokenSealed);
    if (token) {
      try {
        const all = await listRelayKeys(endpoints, token);
        keys = all.map((k: RelayKey) => ({
          id: k.id,
          name: k.name,
          last4: k.apiKey.slice(-4),
          status: k.status,
          groupName: k.groupName,
          selected: k.id === auth.selectedKeyId || (!auth.selectedKeyId && k.apiKey.slice(-4) === auth.selectedKeyLast4),
        }));
      } catch {
        // 中转站不可达：keys 留空，面板登录态仍可见
      }
    }
  }

  return {
    loggedIn: !!auth && !!auth.accessTokenSealed,
    user: auth?.user ?? null,
    tokenMasked: auth?.tokenMasked ?? null,
    isMember: membership.isMember,
    plan: membership.plan,
    expiresAt: membership.expiresAt,
    entitlements: membership.entitlements,
    subscriptions: membership.subscriptions,
    keys,
    selectedModel: auth?.selectedModel || endpoints.defaultModel,
    endpoints,
  };
}

/** 账密登录：token 加密落库 → 立即跑一次对账（拉订阅快照 + 预选第一把生效 key）。 */
export async function relayLoginWithPassword(
  db: DbClient,
  userId: string,
  input: { email: string; password: string },
): Promise<{ user: Record<string, unknown> | null; plan: string | null; isMember: boolean }> {
  const { relayLogin } = await import('./client.js');
  const endpoints = await getRelayRuntimeConfig(db);
  const { accessToken, user } = await relayLogin(endpoints, input);
  const sealed = await sealRelayToken(db, accessToken);
  await db.query(
    `
      insert into relay_auth(user_id, access_token_encrypted, token_masked, user_json, updated_at)
      values ($1, $2, $3, $4, now())
      on conflict (user_id) do update
        set access_token_encrypted = $2, token_masked = $3, user_json = $4, updated_at = now()
    `,
    [userId, sealed.encrypted, sealed.masked, JSON.stringify(user ?? {})],
  );
  const membership = await syncMembership(db, userId);
  return { user: user ?? null, plan: membership.plan, isMember: membership.isMember };
}

export async function relayLogout(db: DbClient, userId: string): Promise<void> {
  await db.query(`delete from relay_auth where user_id = $1`, [userId]);
  await db.query(`delete from relay_membership_snapshot where user_id = $1`, [userId]);
}

/** 选中某一把 key（尾 4 匹配落库；明文 key 只在解密后供 AI 调用，不落库不回显）。 */
export async function selectRelayKey(db: DbClient, userId: string, keyId: string): Promise<void> {
  const auth = await readRelayAuth(db, userId);
  if (!auth) throw new Error('请先登录中转站');
  const endpoints = await getRelayRuntimeConfig(db);
  const token = await openRelayToken(db, auth.accessTokenSealed);
  if (!token) throw new Error('中转站登录态已失效，请重新登录');
  const keys = await listRelayKeys(endpoints, token);
  const hit = keys.find((k) => k.id === keyId);
  if (!hit) throw new Error('该 Key 不存在或已删除');
  await db.query(
    `update relay_auth set selected_key_id = $2, selected_key_last4 = $3, updated_at = now() where user_id = $1`,
    [userId, hit.id, hit.apiKey.slice(-4)],
  );
}

export async function selectRelayModel(db: DbClient, userId: string, model: string): Promise<void> {
  await db.query(`update relay_auth set selected_model = $2, updated_at = now() where user_id = $1`, [userId, model.trim()]);
}

export interface MembershipSyncResult {
  isMember: boolean;
  plan: string | null;
  expiresAt: string | null;
  entitlements: string[];
  subscriptions: RelaySubscriptionView[];
}

/**
 * 登录对账（中转站是唯一源头，本地是镜像）：
 * 拉生效订阅 → 按 relay_membership_group 映射权益并集（isPaid 纪律）→ 快照落库。
 * 中转站一把生效订阅都没有 → 快照清空为免费态。
 */
export async function syncMembership(db: DbClient, userId: string): Promise<MembershipSyncResult> {
  const { listActiveSubscriptions } = await import('./client.js');
  const endpoints = await getRelayRuntimeConfig(db);
  const auth = await readRelayAuth(db, userId);
  if (!auth) throw new Error('请先登录中转站');
  const token = await openRelayToken(db, auth.accessTokenSealed);
  if (!token) throw new Error('中转站登录态已失效，请重新登录');

  const subscriptions = await listActiveSubscriptions(endpoints, token);
  const active = subscriptions.filter((s) => s.status === 'active' || s.status === 'valid');

  // 分组 → 权益映射（本地表；is_paid 纪律：免费档权益不计入会员判定）
  const { rows: groupRows } = await db.query<{ group_id: number; entitlements: string[]; is_paid: boolean }>(
    `select group_id, entitlements, is_paid from relay_membership_group where enabled = true`,
  );
  const entitlementsByGroup = new Map(groupRows.map((g) => [Number(g.group_id), { e: g.entitlements ?? [], paid: g.is_paid }]));

  const entitlements = new Set<string>();
  let isMember = false;
  let plan: string | null = null;
  let expiresAt: string | null = null;
  for (const sub of active) {
    if (sub.groupId === null) continue;
    const mapped = entitlementsByGroup.get(sub.groupId);
    if (!mapped) continue;
    for (const point of mapped.e) entitlements.add(point);
    if (mapped.paid && !isMember) {
      isMember = true;
      plan = sub.plan;
      expiresAt = sub.expiresAt;
    }
  }

  await db.query(
    `
      insert into relay_membership_snapshot(user_id, subscriptions, entitlements, is_member, synced_at)
      values ($1, $2, $3, $4, now())
      on conflict (user_id) do update
        set subscriptions = $2, entitlements = $3, is_member = $4, synced_at = now()
    `,
    [userId, JSON.stringify(subscriptions), JSON.stringify([...entitlements]), isMember],
  );

  return {
    isMember,
    plan,
    expiresAt,
    entitlements: [...entitlements],
    subscriptions: active,
  };
}

/** relay 档 AI 凭据解析：业务 AI 调用（providerMode='relay'）取选中的 key + 模型。 */
export async function resolveRelayAiCredential(
  db: DbClient,
  userId: string,
): Promise<{ apiBaseUrl: string; apiKey: string; model: string }> {
  const endpoints = await getRelayRuntimeConfig(db);
  const auth = await readRelayAuth(db, userId);
  if (!auth) throw new Error('请先在中转站完成授权登录');
  const keySealed = auth.selectedKeyId;
  const token = await openRelayToken(db, auth.accessTokenSealed);
  if (!token) throw new Error('中转站登录态已失效，请重新登录');
  const keys = await listRelayKeys(endpoints, token);
  const hit = keys.find((k) => k.id === keySealed) ?? keys.find((k) => k.apiKey.slice(-4) === auth.selectedKeyLast4) ?? keys[0];
  if (!hit) throw new Error('中转站名下没有可用的 API Key');
  return { apiBaseUrl: endpoints.llmBaseUrl, apiKey: hit.apiKey, model: auth.selectedModel || endpoints.defaultModel };
}
