/**
 * 中转站（sub2api / GaoTK）API 客户端 —— 契约对标 Skoob packages/studio/src/api/sub2api-keys.ts
 * （对着 sub2api 源码抄的，不是猜的）：
 *   POST /api/v1/auth/login            账密登录 → { code:0, data:{ access_token, user } }
 *   GET  /api/v1/keys                  用户 key 列表（明文 key 字段）
 *   GET  /api/v1/subscriptions/active  生效中的订阅 = 会员卡
 *   GET  /api/v1/payment/plans         在售套餐
 *   GET  /api/v1/auth/me               Bearer key/token 验证（用户+余额+分组）
 *   GET  /v1/models                    OpenAI 兼容模型列表（LLM base）
 * 响应统一 `{ code:0, message, data }`。
 */
import { isSealed } from '@/server/infra/crypto/secretBox';
import { sealCredential, openCredential } from '@/core/platform-accounts/secrets';
import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export const DEFAULT_RELAY_API_URL = 'https://lai.gaotk.com';
export const DEFAULT_RELAY_LLM_BASE_URL = 'https://lai.gaotk.com/v1';

export interface RelayEndpointConfig {
  /** 中转站面板 API base（不带尾斜杠）。 */
  apiUrl: string;
  /** OpenAI 兼容 LLM base（含 /v1）。 */
  llmBaseUrl: string;
}

export function resolveRelayEndpoints(env: NodeJS.ProcessEnv = process.env): RelayEndpointConfig {
  return {
    apiUrl: (env.RELAY_API_URL ?? DEFAULT_RELAY_API_URL).replace(/\/+$/, ''),
    llmBaseUrl: (env.RELAY_LLM_BASE_URL ?? DEFAULT_RELAY_LLM_BASE_URL).replace(/\/+$/, ''),
  };
}

/** 中转站统一信封：`{ code:0, message, data }`。 */
async function unwrap(res: Response, label: string): Promise<unknown> {
  const json = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: unknown } | null;
  if (!res.ok || !json || json.code !== 0) {
    const message = json?.message ?? `中转站${label}失败（HTTP ${res.status}）`;
    throw new RelayError(message, res.status === 401 ? 'relay_unauthorized' : 'relay_error');
  }
  return json.data;
}

export class RelayError extends Error {
  code: string;
  status?: number;
  constructor(message: string, code = 'relay_error', status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface RelayLoginResult {
  accessToken: string;
  user: Record<string, unknown> | null;
}

/** 账密登录（Skoob 主通路：auth/login 转发官网验证，token 交调用方保管，服务端不留）。 */
export async function relayLogin(
  endpoints: RelayEndpointConfig,
  input: { email: string; password: string },
): Promise<RelayLoginResult> {
  const res = await fetch(`${endpoints.apiUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: input.email, password: input.password }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await unwrap(res, '登录')) as { access_token?: string; user?: Record<string, unknown> } | null;
  if (!data?.access_token) throw new RelayError('登录成功但未返回令牌', 'relay_error');
  return { accessToken: data.access_token, user: (data.user ?? null) as Record<string, unknown> | null };
}

export interface RelayKey {
  id: string;
  name: string;
  /** 明文——上游就是这么返回的；本插件只落加密库、面板只回显尾 4 位。 */
  apiKey: string;
  status: string;
  groupId: number | null;
  groupName: string | null;
  quota: number;
  quotaUsed: number;
  expiresAt: string | null;
}

function mapKey(row: Record<string, unknown>): RelayKey {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? '未命名'),
    apiKey: String(row.key ?? ''),
    status: String(row.status ?? ''),
    groupId: typeof row.group_id === 'number' ? row.group_id : null,
    groupName: (row.group as { name?: string } | null)?.name ?? null,
    quota: typeof row.quota === 'number' ? row.quota : 0,
    quotaUsed: typeof row.used_quota === 'number' ? row.used_quota : 0,
    expiresAt: typeof row.expired_time === 'string' ? row.expired_time : null,
  };
}

export async function listRelayKeys(endpoints: RelayEndpointConfig, accessToken: string): Promise<RelayKey[]> {
  const res = await fetch(`${endpoints.apiUrl}/api/v1/keys?page=1&page_size=100&status=enabled`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await unwrap(res, '读取 Key 列表')) as { items?: Array<Record<string, unknown>>; list?: Array<Record<string, unknown>> } | null;
  const rows = data?.items ?? data?.list ?? (Array.isArray(data) ? data : []);
  return (rows as Array<Record<string, unknown>>).map(mapKey).filter((k) => k.id);
}

export interface RelaySubscription {
  id: number | null;
  plan: string | null;
  groupId: number | null;
  status: string;
  expiresAt: string | null;
}

export async function listActiveSubscriptions(
  endpoints: RelayEndpointConfig,
  accessToken: string,
): Promise<RelaySubscription[]> {
  const res = await fetch(`${endpoints.apiUrl}/api/v1/subscriptions/active`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await unwrap(res, '读取会员订阅');
  const rows: Array<Record<string, unknown>> = Array.isArray(data)
    ? (data as Array<Record<string, unknown>>)
    : ((data as { items?: Array<Record<string, unknown>> } | null)?.items ?? []);
  return rows.map((row) => ({
    id: typeof row.id === 'number' ? row.id : null,
    plan: (row.group as { name?: string } | null)?.name ?? null,
    groupId: typeof row.group_id === 'number' ? row.group_id : null,
    status: typeof row.status === 'string' ? row.status : 'active',
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
  }));
}

/** 中转站侧可用模型（OpenAI 兼容 /models，用用户 key 调 LLM base）。 */
export async function listRelayModels(
  endpoints: RelayEndpointConfig,
  apiKey: string,
): Promise<Array<{ id: string; name?: string }>> {
  const res = await fetch(`${endpoints.llmBaseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown; name?: unknown }> } | null;
  if (!res.ok || !Array.isArray(json?.data)) return [];
  return json.data
    .filter((entry): entry is { id: string; name?: string } => typeof entry.id === 'string')
    .map((entry) => ({ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id }));
}

// ============================================================
// 凭据存取（secretBox 加密；明文只在单次调用内存活，与 oauth hub 同纪律）
// ============================================================

export interface SealedToken {
  encrypted: string;
  masked: string;
}

export function maskRelayToken(accessToken: string): string {
  return accessToken.length >= 8
    ? `${accessToken.slice(0, 4)}****${accessToken.slice(-4)}`
    : '****';
}

/** token 加密落库（secretBox，密钥走 env→DB 兜底链）。 */
export async function sealRelayToken(db: DbClient, accessToken: string): Promise<SealedToken> {
  return { encrypted: await sealCredential(db, accessToken), masked: maskRelayToken(accessToken) };
}

/** token 解密（明文只在调用方内存存活；解密失败返回 null = 未授权）。 */
export async function openRelayToken(db: DbClient, sealed: string): Promise<string | null> {
  if (!sealed) return null;
  try {
    return isSealed(sealed) ? await openCredential(db, sealed) : sealed;
  } catch {
    return null;
  }
}
