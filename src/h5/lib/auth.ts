/**
 * H5 自有 auth 客户端：插件 /s/api/* 不是 {ok,data} 信封，直接 fetch。
 *
 * 会话令牌走两条路：
 *   - cookie `superman_session`：浏览器直连、DSH Web 客户端（http 源）用它；
 *   - `Authorization: Bearer <token>`：DSH **桌面**客户端把界面装在 `dsh-app://app`
 *     自定义协议下，主进程转发本地请求时会删掉页面自带的 cookie、并剥掉响应里的
 *     set-cookie，cookie 会话在那种壳里立不住，只能靠请求头（请求头原样透传）。
 * 所以登录后把令牌存进 localStorage，之后每个 /s/api 请求都带上它；cookie 通道不受影响。
 */

export interface H5Session {
  authenticated: boolean;
  username: string | null;
}

const TOKEN_STORAGE_KEY = 'superman.session.token';

/** localStorage 不可用时的兜底：至少让当前页面生命周期内可用。 */
let memoryToken: string | null = null;

/** 读取本地保存的会话令牌。 */
export function readSessionToken(): string | null {
  try {
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored !== null) return stored;
  } catch {
    // 隐私模式 / 自定义协议下可能抛错，走内存兜底
  }
  return memoryToken;
}

/** 写入/清除本地会话令牌；localStorage 不可用时退回内存。 */
export function writeSessionToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // 忽略：上面已经写进内存
  }
}

/** 给请求补上会话令牌头。 */
export function withSessionAuth(init: RequestInit = {}): RequestInit {
  const token = readSessionToken();
  if (!token) return init;
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

/** 所有 /s/api 调用都走它，保证令牌头不漏。 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, withSessionAuth(init));
}

export async function fetchSession(): Promise<H5Session> {
  try {
    const res = await apiFetch('/s/api/auth/session', { headers: { accept: 'application/json' } });
    const json = (await res.json()) as { authenticated?: boolean; username?: string | null };
    return { authenticated: json.authenticated === true, username: json.username ?? null };
  } catch {
    return { authenticated: false, username: null };
  }
}

export async function loginH5(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/s/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; token?: string } | null;
    if (res.ok && json?.ok) {
      if (typeof json.token === 'string' && json.token) writeSessionToken(json.token);
      return { ok: true };
    }
    return { ok: false, error: json?.error ?? '登录失败，请稍后重试' };
  } catch {
    return { ok: false, error: '网络异常，请检查 DSH 是否在线' };
  }
}

/**
 * DSH 宿主免登录：用宿主侧 DeepSeek 身份换 Superman 会话令牌。
 * 仅 DSH 宿主（dsh-app:// 协议 / ?host=dsh iframe）可用；宿主未登录 DeepSeek、
 * 通道未启用或网络失败时返回 false，调用方回落口令登录页。
 */
export async function signInWithHost(): Promise<boolean> {
  try {
    const res = await fetch('/s/api/auth/host-session', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as { ok?: boolean; token?: string } | null;
    if (!json?.ok || typeof json.token !== 'string' || !json.token) return false;
    writeSessionToken(json.token);
    return true;
  } catch {
    return false;
  }
}

export async function logoutH5(): Promise<void> {
  await apiFetch('/s/api/auth/logout', { method: 'POST' }).catch(() => {});
  writeSessionToken(null);
}
