/**
 * 抖音 vendor 服务客户端 + 扫码会话管理（P2e-2 收口）。
 *
 * vendor（sau_backend.py，默认 127.0.0.1:5409）降级为纯执行器：
 *   - 共享密钥：env SAU_TOKEN，随 X-Sau-Token 头发送（vendor 未配置时免鉴权）；
 *   - 扫码登录：vendor 的 /login 是 SSE 流（先推二维码 src，再推 200/500），
 *     本模块把它包成「会话 + 轮询」模型供 H5 使用；
 *   - cookie 上收：登录成功后 ① vendor 回调回推 storage_state（主路）
 *     ② confirm 接口拉取（/getAccounts + /downloadCookie，兜底）——
 *     两路都会 secretBox 加密落 platform_accounts，明文只在函数内存在。
 */
import { randomUUID } from 'node:crypto';

export interface SauConfig {
  baseUrl: string;
  token: string;
}

export function resolveSauConfig(env: NodeJS.ProcessEnv = process.env): SauConfig {
  return {
    baseUrl: (env.SAU_BASE_URL ?? 'http://127.0.0.1:5409').replace(/\/+$/, ''),
    token: (env.SAU_TOKEN ?? '').trim(),
  };
}

/** 测试注入点：替换底层 fetch。 */
export type SauFetcher = typeof fetch;

// ============================================================
// vendor 接口封装
// ============================================================

export interface VendorAccountRow {
  /** user_info 行：[id, type, filePath, userName, status]。 */
  id: number;
  type: number;
  filePath: string;
  userName: string;
  status: number;
}

function parseVendorAccountRow(row: unknown): VendorAccountRow | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const [id, type, filePath, userName, status] = row as unknown[];
  if (typeof userName !== 'string' || typeof filePath !== 'string') return null;
  return {
    id: Number(id),
    type: Number(type),
    filePath,
    userName,
    status: Number(status),
  };
}

async function sauRequest(
  config: SauConfig,
  input: { path: string; method?: 'GET' | 'POST'; body?: unknown; fetcher?: SauFetcher },
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const fetcher = input.fetcher ?? fetch;
  const headers: Record<string, string> = {};
  if (config.token) headers['x-sau-token'] = config.token;
  if (input.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetcher(`${config.baseUrl}${input.path}`, {
    method: input.method ?? 'GET',
    headers,
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

export async function listVendorAccounts(
  config: SauConfig,
  deps?: { fetcher?: SauFetcher },
): Promise<VendorAccountRow[]> {
  const { status, json } = await sauRequest(config, {
    path: '/getAccounts',
    fetcher: deps?.fetcher,
  });
  if (status !== 200 || !Array.isArray(json?.data)) return [];
  return (json.data as unknown[])
    .map(parseVendorAccountRow)
    .filter((row): row is VendorAccountRow => row !== null && row.type === 3);
}

/** 拉取 cookie 文件内容（storage_state JSON）。 */
export async function downloadVendorCookie(
  config: SauConfig,
  filePath: string,
  deps?: { fetcher?: SauFetcher },
): Promise<Record<string, unknown> | null> {
  const fetcher = deps?.fetcher ?? fetch;
  const headers: Record<string, string> = {};
  if (config.token) headers['x-sau-token'] = config.token;
  const res = await fetcher(
    `${config.baseUrl}/downloadCookie?filePath=${encodeURIComponent(filePath)}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (res.status !== 200) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

// ============================================================
// 扫码会话（SSE → 会话 + 轮询）
// ============================================================

export type DouyinLoginSessionStatus = 'pending' | 'scanned' | 'confirmed' | 'expired';

export interface DouyinLoginSession {
  id: string;
  userId: string;
  accountName: string;
  status: DouyinLoginSessionStatus;
  /** 二维码图片（vendor 推来的 src：http(s) URL 或 data-url）。 */
  qrSrc: string | null;
  createdAtMs: number;
  /** vendor 侧账号名（= 会话 id，回调/拉取时据此对账）。 */
  vendorUserName: string;
}

const sessions = new Map<string, DouyinLoginSession>();
const SESSION_TTL_MS = 220_000; // vendor 扫码超时 200s + 余量

export function getDouyinLoginSession(id: string): DouyinLoginSession | null {
  return sessions.get(id) ?? null;
}

function sweepExpiredSessions(): void {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (
      (session.status === 'pending' || session.status === 'scanned') &&
      now - session.createdAtMs > SESSION_TTL_MS
    ) {
      session.status = 'expired';
    }
  }
}

/** 测试钩子：清空会话表。 */
export function resetDouyinLoginSessionsForTest(): void {
  sessions.clear();
}

export interface DouyinLoginDeps {
  config?: SauConfig;
  fetcher?: SauFetcher;
  uuid?: () => string;
}

/**
 * 创建扫码会话：向 vendor /login?type=3&id=<sessionId> 开 SSE，
 * 后台消费事件流更新会话状态（二维码 src → confirmed/expired）。
 * SSE 建连失败会话直接 expired（H5 拿到状态可提示「执行器未就绪」）。
 */
export function startDouyinLoginSession(input: {
  userId: string;
  accountName: string;
  deps?: DouyinLoginDeps;
}): DouyinLoginSession {
  sweepExpiredSessions();
  const config = input.deps?.config ?? resolveSauConfig();
  const uuid = input.deps?.uuid ?? randomUUID;
  const sessionId = uuid();
  const session: DouyinLoginSession = {
    id: sessionId,
    userId: input.userId,
    accountName: input.accountName,
    status: 'pending',
    qrSrc: null,
    createdAtMs: Date.now(),
    vendorUserName: sessionId,
  };
  sessions.set(sessionId, session);

  void consumeVendorLoginSse(session, config, input.deps?.fetcher ?? fetch).catch(() => {
    if (session.status === 'pending' || session.status === 'scanned') {
      session.status = 'expired';
    }
  });
  return session;
}

async function consumeVendorLoginSse(
  session: DouyinLoginSession,
  config: SauConfig,
  fetcher: SauFetcher,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (config.token) headers['x-sau-token'] = config.token;
  const res = await fetcher(
    `${config.baseUrl}/login?type=3&id=${encodeURIComponent(session.vendorUserName)}`,
    { headers, signal: AbortSignal.timeout(240_000) },
  );
  if (!res.ok || !res.body) {
    session.status = 'expired';
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE 帧：data: <msg>\n\n
    let sepIndex = buffer.indexOf('\n\n');
    while (sepIndex >= 0) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      sepIndex = buffer.indexOf('\n\n');
      const data = frame.replace(/^data:\s?/, '').trim();
      if (!data) continue;
      if (data === '200') {
        session.status = 'confirmed';
      } else if (data === '500') {
        session.status = 'expired';
      } else if (!session.qrSrc) {
        session.qrSrc = data;
      }
    }
  }
  // 流结束仍未确认 → 视为过期
  if (session.status === 'pending' || session.status === 'scanned') {
    session.status = 'expired';
  }
}
