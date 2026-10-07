/**
 * 会话令牌的浏览器端存取 + 媒体 URL 令牌追加（无依赖叶模块，h5 与共享组件共用）。
 *
 * 为什么媒体 URL 需要特殊处理：DSH 桌面壳（dsh-app://）里主进程会剥掉页面 cookie，
 * 会话只能走 `Authorization: Bearer` 头；而 `<video>`/`<img>` 等媒体标签发起的请求
 * 带不了自定义头。插件宿主的媒体流路由因此接受 `?access_token=` 查询串令牌
 * （服务端仅本机回环伺服，令牌不外泄）；浏览器/Next.js 场景没有本地令牌，
 * 本模块原样返回 URL，cookie 照常随媒体请求走。
 */
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

/** 媒体流 URL 追加会话令牌；无令牌时原样返回（cookie 场景不受影响）。 */
export function withAccessToken(url: string): string {
  const token = readSessionToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
}
