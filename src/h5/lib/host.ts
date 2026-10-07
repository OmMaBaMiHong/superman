/**
 * H5 运行宿主探测：区分「DSH 宿主」与「普通浏览器」两种形态。
 *
 * - `dsh`：DSH 桌面客户端（整个界面装在 dsh-app:// 自定义协议下，含内嵌 iframe
 *   与独立窗口）与 DSH Web 客户端（http 源，client 半 iframe 以 ?host=dsh 标记）。
 *   此形态下：免登录走 /s/api/auth/host-session，导航壳用面板内标签条。
 * - `browser`：手机 H5（PWA）与直接用浏览器打开 /s/app。行为与改造前完全一致：
 *   底部 TabBar/桌面 Rail 导航，401 跳口令登录页。
 *
 * 探测只做一次（模块加载期）；所有 DSH 特化都应基于 HOST 分支或 html 上的
 * data-host 属性（CSS 门控用），不得反向假设 browser 形态的实现细节。
 */

export type HostKind = 'dsh' | 'browser';

function detectHost(): HostKind {
  if (typeof window === 'undefined') return 'browser';
  // DSH 桌面客户端：页面经 dsh-app:// 协议伺服（Electron 主进程转发本地请求）。
  if (window.location.protocol === 'dsh-app:') return 'dsh';
  // DSH Web 客户端：http 源 iframe 由插件 client 半拼 URL，用查询参数显式标记。
  try {
    if (new URLSearchParams(window.location.search).get('host') === 'dsh') return 'dsh';
  } catch {
    // search 解析失败按 browser 处理
  }
  return 'browser';
}

export const HOST: HostKind = detectHost();

/** 把宿主形态挂到 <html data-host>，供 globals.css 的形态门控选择器使用。 */
export function applyHostAttributes(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.host = HOST;
}
