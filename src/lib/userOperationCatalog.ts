import type { SystemLogCategory } from '../types';

export type UserOperationMode = 'immediate' | 'deferred';
export type UserOperationToastStage = 'started' | 'success' | 'error';
type UserOperationToastVisibility = Partial<Record<UserOperationToastStage, boolean>>;

export type UserOperationActionKey =
  | 'feed.create'
  | 'feed.update'
  | 'feed.delete'
  | 'feed.enable'
  | 'feed.disable'
  | 'feed.moveToCategory'
  | 'feed.refresh'
  | 'feed.refreshAll'
  | 'fever.sync'
  | 'feed.articleListDisplayMode.update'
  | 'category.create'
  | 'category.update'
  | 'category.delete'
  | 'category.reorder'
  | 'article.markRead'
  | 'article.markAllRead'
  | 'article.toggleStar'
  | 'article.aiSummary.generate'
  | 'article.aiTranslate.generate'
  | 'article.aiTranslate.retrySegment'
  | 'aiDigest.create'
  | 'aiDigest.update'
  | 'aiDigest.generate'
  | 'github.repo.create'
  | 'github.repo.update'
  | 'github.repo.delete'
  | 'github.repo.refresh'
  | 'github.token.save'
  | 'github.token.clear'
  | 'oauth.config.save'
  | 'oauth.config.clear'
  | 'oauth.authorize.start'
  | 'oauth.authorize.result'
  | 'oauth.connection.revoke'
  | 'oauth.connection.refresh'
  | 'rsshub.cookie.save'
  | 'rsshub.cookie.clear'
  | 'settings.save'
  | 'opml.import'
  | 'opml.export';

export interface UserOperationCatalogEntry {
  mode: UserOperationMode;
  category: SystemLogCategory;
  successMessage: (context?: Record<string, unknown>) => string;
  errorPrefix: (context?: Record<string, unknown>) => string;
  startMessage?: (context?: Record<string, unknown>) => string;
  toastVisibility?: UserOperationToastVisibility;
}

const DEFAULT_FAILURE_REASON = '请稍后重试';
const MAX_REASON_LENGTH = 72;
const HIDE_SUCCESS_TOAST: UserOperationToastVisibility = { success: false };
const HIDE_SUCCESS_ERROR_TOASTS: UserOperationToastVisibility = {
  success: false,
  error: false,
};
const HIDE_ALL_TOASTS: UserOperationToastVisibility = {
  started: false,
  success: false,
  error: false,
};

function getStringContextValue(
  context: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = context?.[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function withDefaultCategory(context?: Record<string, unknown>) {
  const categoryName = getStringContextValue(context, 'categoryName');
  return categoryName ? `已移动到「${categoryName}」` : '已移动订阅源';
}

const catalog: Record<UserOperationActionKey, UserOperationCatalogEntry> = {
  'feed.create': {
    mode: 'immediate',
    category: 'feed',
    successMessage: () => '已添加订阅源',
    errorPrefix: () => '添加订阅源失败',
  },
  'feed.update': {
    mode: 'immediate',
    category: 'feed',
    successMessage: () => '已更新订阅源',
    errorPrefix: () => '更新订阅源失败',
  },
  'feed.delete': {
    mode: 'immediate',
    category: 'feed',
    successMessage: () => '已删除订阅源',
    errorPrefix: () => '删除订阅源失败',
  },
  'feed.enable': {
    mode: 'immediate',
    category: 'feed',
    successMessage: () => '已启用订阅源',
    errorPrefix: () => '启用订阅源失败',
  },
  'feed.disable': {
    mode: 'immediate',
    category: 'feed',
    successMessage: () => '已停用订阅源',
    errorPrefix: () => '停用订阅源失败',
  },
  'feed.moveToCategory': {
    mode: 'immediate',
    category: 'feed',
    successMessage: (context) => withDefaultCategory(context),
    errorPrefix: () => '移动订阅源失败',
  },
  'feed.refresh': {
    mode: 'deferred',
    category: 'feed',
    startMessage: () => '已开始刷新订阅源',
    successMessage: () => '订阅源已刷新',
    errorPrefix: () => '刷新订阅源失败',
  },
  'feed.refreshAll': {
    mode: 'deferred',
    category: 'feed',
    startMessage: () => '已开始刷新全部订阅源',
    successMessage: () => '全部订阅源已刷新',
    errorPrefix: () => '刷新全部订阅源失败',
  },
  'fever.sync': {
    mode: 'immediate',
    category: 'settings',
    successMessage: (context) => {
      if (context?.outcome === 'synced') {
        return 'Fever 账号已同步';
      }
      if (context?.outcome === 'already_enqueued') {
        return 'Fever 同步已在队列中';
      }
      if (context?.outcome === 'settings_saved') {
        return '已保存 Fever 账号设置';
      }
      if (context?.outcome === 'deleted') {
        return '已删除 Fever 服务和其源';
      }

      return '已开始同步 Fever 账号';
    },
    errorPrefix: () => '同步 Fever 账号失败',
  },
  'feed.articleListDisplayMode.update': {
    mode: 'immediate',
    category: 'feed',
    successMessage: () => '已保存文章列表显示方式',
    errorPrefix: () => '保存文章列表显示方式失败',
    // Toolbar pressed state changes immediately, so success toast is redundant noise.
    toastVisibility: HIDE_SUCCESS_TOAST,
  },
  'category.create': {
    mode: 'immediate',
    category: 'category',
    successMessage: () => '已添加分类',
    errorPrefix: () => '添加分类失败',
  },
  'category.update': {
    mode: 'immediate',
    category: 'category',
    successMessage: () => '已更新分类',
    errorPrefix: () => '更新分类失败',
  },
  'category.delete': {
    mode: 'immediate',
    category: 'category',
    successMessage: () => '已删除分类',
    errorPrefix: () => '删除分类失败',
  },
  'category.reorder': {
    mode: 'immediate',
    category: 'category',
    successMessage: () => '已更新分类顺序',
    errorPrefix: () => '更新分类顺序失败',
  },
  'article.markRead': {
    mode: 'immediate',
    category: 'article',
    successMessage: () => '已标记为已读',
    errorPrefix: () => '标记为已读失败',
    // Reading itself already implies progress; avoid firing a toast on every open.
    toastVisibility: HIDE_SUCCESS_TOAST,
  },
  'article.markAllRead': {
    mode: 'immediate',
    category: 'article',
    successMessage: () => '已标记全部为已读',
    errorPrefix: () => '标记全部为已读失败',
  },
  'article.toggleStar': {
    mode: 'immediate',
    category: 'article',
    successMessage: (context) => {
      const starred = context?.starred === true;
      return starred ? '已加星标' : '已取消星标';
    },
    errorPrefix: (context) => {
      const starred = context?.starred === true;
      return starred ? '加星标失败' : '取消星标失败';
    },
    // The star icon/button label already reflects the new state inline.
    toastVisibility: HIDE_SUCCESS_TOAST,
  },
  'article.aiSummary.generate': {
    mode: 'deferred',
    category: 'ai_summary',
    startMessage: () => '已开始生成 AI 摘要',
    successMessage: () => 'AI 摘要已生成',
    errorPrefix: () => '生成 AI 摘要失败',
    // Summary status, loading text, and failure UI are rendered inline in the reader pane.
    toastVisibility: HIDE_ALL_TOASTS,
  },
  'article.aiTranslate.generate': {
    mode: 'deferred',
    category: 'ai_translate',
    startMessage: () => '已开始生成 AI 翻译',
    successMessage: () => 'AI 翻译已生成',
    errorPrefix: () => '生成 AI 翻译失败',
  },
  'article.aiTranslate.retrySegment': {
    mode: 'deferred',
    category: 'ai_translate',
    startMessage: () => '已开始重试翻译片段',
    successMessage: () => '翻译片段已重试完成',
    errorPrefix: () => '重试翻译片段失败',
  },
  'aiDigest.create': {
    mode: 'immediate',
    category: 'ai_digest',
    successMessage: () => '已创建智能报告源',
    errorPrefix: () => '创建智能报告源失败',
  },
  'aiDigest.update': {
    mode: 'immediate',
    category: 'ai_digest',
    successMessage: () => '已更新智能报告源',
    errorPrefix: () => '更新智能报告源失败',
  },
  'aiDigest.generate': {
    mode: 'deferred',
    category: 'ai_digest',
    startMessage: () => '已开始生成智能报告',
    successMessage: (context) =>
      context?.outcome === 'no_relevant_updates' ? '当前时间窗口没有相关内容' : '智能报告已生成',
    errorPrefix: () => '生成智能报告失败',
  },
  'github.repo.create': {
    mode: 'immediate',
    category: 'github',
    successMessage: (context) =>
      typeof context?.fullName === 'string'
        ? `已订阅 ${context.fullName}`
        : '已添加 GitHub 仓库订阅',
    errorPrefix: () => '添加 GitHub 仓库订阅失败',
  },
  'github.repo.update': {
    mode: 'immediate',
    category: 'github',
    successMessage: () => '已更新 GitHub 仓库订阅',
    errorPrefix: () => '更新 GitHub 仓库订阅失败',
  },
  'github.repo.delete': {
    mode: 'immediate',
    category: 'github',
    successMessage: () => '已删除 GitHub 仓库订阅',
    errorPrefix: () => '删除 GitHub 仓库订阅失败',
  },
  'github.repo.refresh': {
    mode: 'deferred',
    category: 'github',
    startMessage: () => '已开始同步仓库',
    successMessage: (context) =>
      context?.outcome === 'already_enqueued' ? '同步任务已在队列中' : '仓库同步已加入队列',
    errorPrefix: () => '同步仓库失败',
  },
  'github.token.save': {
    mode: 'immediate',
    category: 'github',
    successMessage: () => '已保存 GitHub Token',
    errorPrefix: () => '保存 GitHub Token 失败',
  },
  'github.token.clear': {
    mode: 'immediate',
    category: 'github',
    successMessage: () => '已清除 GitHub Token',
    errorPrefix: () => '清除 GitHub Token 失败',
  },
  'oauth.config.save': {
    mode: 'immediate',
    category: 'oauth',
    successMessage: (context) =>
      typeof context?.displayName === 'string'
        ? `已保存 ${context.displayName} 应用配置`
        : '已保存平台应用配置',
    errorPrefix: () => '保存平台应用配置失败',
  },
  'oauth.config.clear': {
    mode: 'immediate',
    category: 'oauth',
    successMessage: (context) =>
      typeof context?.displayName === 'string'
        ? `已清除 ${context.displayName} 应用配置`
        : '已清除平台应用配置',
    errorPrefix: () => '清除平台应用配置失败',
  },
  'oauth.authorize.start': {
    mode: 'immediate',
    category: 'oauth',
    // 成功即跳转到平台，页面马上卸载，成功 toast 没有展示窗口。
    successMessage: () => '正在跳转到平台授权页',
    errorPrefix: () => '发起授权失败',
    toastVisibility: HIDE_SUCCESS_TOAST,
  },
  'oauth.authorize.result': {
    mode: 'immediate',
    category: 'oauth',
    successMessage: (context) =>
      typeof context?.displayName === 'string'
        ? `已连接 ${context.displayName}`
        : '授权成功',
    errorPrefix: (context) =>
      typeof context?.displayName === 'string'
        ? `${context.displayName} 授权失败`
        : '授权失败',
  },
  'oauth.connection.revoke': {
    mode: 'immediate',
    category: 'oauth',
    successMessage: (context) =>
      typeof context?.displayName === 'string'
        ? `已断开 ${context.displayName}`
        : '已断开授权连接',
    errorPrefix: () => '断开授权连接失败',
  },
  'oauth.connection.refresh': {
    mode: 'immediate',
    category: 'oauth',
    successMessage: (context) =>
      typeof context?.displayName === 'string'
        ? `已续期 ${context.displayName}`
        : '已续期访问令牌',
    errorPrefix: () => '续期访问令牌失败',
  },
  'rsshub.cookie.save': {
    mode: 'immediate',
    category: 'settings',
    successMessage: (context) =>
      typeof context?.displayName === 'string'
        ? `已保存 ${context.displayName} Cookie`
        : '已保存平台 Cookie',
    errorPrefix: () => '保存平台 Cookie 失败',
  },
  'rsshub.cookie.clear': {
    mode: 'immediate',
    category: 'settings',
    successMessage: (context) =>
      typeof context?.displayName === 'string'
        ? `已清除 ${context.displayName} Cookie`
        : '已清除平台 Cookie',
    errorPrefix: () => '清除平台 Cookie 失败',
  },
  'settings.save': {
    mode: 'immediate',
    category: 'settings',
    successMessage: () => '设置已自动保存',
    errorPrefix: () => '保存设置失败',
    // Drawer header already exposes autosave state and error status.
    toastVisibility: HIDE_SUCCESS_ERROR_TOASTS,
  },
  'opml.import': {
    mode: 'immediate',
    category: 'opml',
    successMessage: () => 'OPML 导入完成',
    errorPrefix: () => '导入 OPML 失败',
    // Import result summary stays visible in the settings panel after completion.
    toastVisibility: HIDE_SUCCESS_TOAST,
  },
  'opml.export': {
    mode: 'immediate',
    category: 'opml',
    successMessage: () => 'OPML 已开始下载',
    errorPrefix: () => '导出 OPML 失败',
    // Browser download feedback is enough on success.
    toastVisibility: HIDE_SUCCESS_TOAST,
  },
};

function toReasonText(reason: unknown): string | null {
  if (reason instanceof Error) {
    return reason.message;
  }

  if (typeof reason === 'string') {
    return reason;
  }

  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }

  return null;
}

export function formatUserOperationFailureReason(reason: unknown): string {
  const raw = toReasonText(reason);
  if (!raw) {
    return DEFAULT_FAILURE_REASON;
  }

  const normalized = raw
    .replace(/\s+/g, ' ')
    .replace(/\s*at\s+.+$/i, '')
    .trim();

  if (!normalized) {
    return DEFAULT_FAILURE_REASON;
  }

  if (normalized.length <= MAX_REASON_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`;
}

export function getUserOperationCatalogEntry(
  actionKey: UserOperationActionKey,
): UserOperationCatalogEntry {
  return catalog[actionKey];
}

export function shouldEmitUserOperationToast(
  actionKey: UserOperationActionKey,
  stage: UserOperationToastStage,
): boolean {
  return getUserOperationCatalogEntry(actionKey).toastVisibility?.[stage] ?? true;
}

export function renderUserOperationStarted(
  actionKey: UserOperationActionKey,
  context?: Record<string, unknown>,
): string {
  const message = getUserOperationCatalogEntry(actionKey).startMessage?.(context);
  return message ?? renderUserOperationSuccess(actionKey, context);
}

export function renderUserOperationSuccess(
  actionKey: UserOperationActionKey,
  context?: Record<string, unknown>,
): string {
  return getUserOperationCatalogEntry(actionKey).successMessage(context);
}

export function renderUserOperationFailure(
  actionKey: UserOperationActionKey,
  reason: unknown,
  context?: Record<string, unknown>,
): string {
  return `${getUserOperationCatalogEntry(actionKey).errorPrefix(context)}：${formatUserOperationFailureReason(reason)}`;
}
