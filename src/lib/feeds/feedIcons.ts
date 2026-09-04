export const AI_DIGEST_ICON_URL = '/ai-digest-icon.svg';
/**
 * GitHub 订阅源的兜底图标。
 *
 * 优先使用仓库 owner 的 avatar（`github_repo_subscriptions.repo_avatar_url`），
 * avatar 缺失或加载失败时回落到本地图标。
 * 注意：avatar 在前端渲染必须走 `imageProxyUrl` 图片代理，避免向 GitHub 泄漏用户 IP。
 */
export const GITHUB_ICON_URL = '/github-icon.svg';
