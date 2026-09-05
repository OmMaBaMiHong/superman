/** H5 自有 auth 客户端：插件 /s/api/auth/* 不是 {ok,data} 信封，直接 fetch。 */

export interface H5Session {
  authenticated: boolean;
  username: string | null;
}

export async function fetchSession(): Promise<H5Session> {
  try {
    const res = await fetch('/s/api/auth/session', { headers: { accept: 'application/json' } });
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
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && json?.ok) return { ok: true };
    return { ok: false, error: json?.error ?? '登录失败，请稍后重试' };
  } catch {
    return { ok: false, error: '网络异常，请检查 DSH 是否在线' };
  }
}

export async function logoutH5(): Promise<void> {
  await fetch('/s/api/auth/logout', { method: 'POST' }).catch(() => {});
}
