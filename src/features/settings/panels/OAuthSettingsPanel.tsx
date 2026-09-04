'use client';

import { useCallback, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SaveOAuthProviderConfigInput } from '@/lib/api/apiClient';
import type { OAuthConnectionView, OAuthProviderConfigStatus, OAuthProviderId } from '@/types';
import {
  runImmediateFailure,
  runImmediateSuccess,
} from '@/features/notifications/userOperationNotifier';
import { useOAuthHub } from '@/features/oauth/hooks/useOAuthHub';
import OAuthProviderCard from '@/features/oauth/components/OAuthProviderCard';
import { getOAuthProviderMeta } from '@/features/oauth/utils/oauthProviderMeta';

function resolveDisplayName(status: OAuthProviderConfigStatus): string {
  return status.displayName || getOAuthProviderMeta(status.provider)?.displayName || status.provider;
}

function resolveConnectionDisplayName(connection: OAuthConnectionView): string {
  return getOAuthProviderMeta(connection.provider)?.displayName ?? connection.provider;
}

/**
 * 「三方授权」设置分区。
 *
 * 与 GitHub 分区平级、版式一致：卡片列表 + `size="compact"` 按钮 + `AlertDialog` 二次确认。
 * 本面板**不持有任何凭据**——接口回来的就只有打码值与状态，前端连明文的机会都没有。
 */
export default function OAuthSettingsPanel() {
  const {
    providers,
    connectionByProvider,
    loading,
    saveConfig,
    clearConfig,
    startAuthorize,
    revokeConnection,
    refreshConnection,
  } = useOAuthHub();

  const [authorizingProvider, setAuthorizingProvider] = useState<OAuthProviderId | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<OAuthConnectionView | null>(null);
  const [revoking, setRevoking] = useState(false);

  const handleSaveConfig = useCallback(
    async (status: OAuthProviderConfigStatus, input: SaveOAuthProviderConfigInput) => {
      const displayName = resolveDisplayName(status);
      try {
        await saveConfig(status.provider, input);
        runImmediateSuccess({ actionKey: 'oauth.config.save', context: { displayName } });
      } catch (err) {
        runImmediateFailure({ actionKey: 'oauth.config.save', err, context: { displayName } });
        // 继续上抛，让表单把消息渲染成内联错误（toast + 内联双通道）。
        throw err;
      }
    },
    [saveConfig],
  );

  const handleClearConfig = useCallback(
    async (status: OAuthProviderConfigStatus) => {
      const displayName = resolveDisplayName(status);
      try {
        await clearConfig(status.provider);
        runImmediateSuccess({ actionKey: 'oauth.config.clear', context: { displayName } });
      } catch (err) {
        runImmediateFailure({ actionKey: 'oauth.config.clear', err, context: { displayName } });
        throw err;
      }
    },
    [clearConfig],
  );

  const handleAuthorize = useCallback(
    async (status: OAuthProviderConfigStatus) => {
      if (authorizingProvider !== null) {
        return;
      }

      const displayName = resolveDisplayName(status);
      setAuthorizingProvider(status.provider);
      try {
        // 带上当前站内路径，回调后 302 能回到用户离开时的位置。
        const returnTo =
          typeof window === 'undefined'
            ? undefined
            : `${window.location.pathname}${window.location.search}`;
        const authorizeUrl = await startAuthorize(status.provider, returnTo);
        // 整页跳转到平台授权页；成功后平台会回调我们的 callback 路由。
        window.location.assign(authorizeUrl);
      } catch (err) {
        runImmediateFailure({ actionKey: 'oauth.authorize.start', err, context: { displayName } });
        setAuthorizingProvider(null);
      }
    },
    [authorizingProvider, startAuthorize],
  );

  const handleRefresh = useCallback(
    async (connection: OAuthConnectionView) => {
      if (refreshingId !== null) {
        return;
      }

      const displayName = resolveConnectionDisplayName(connection);
      setRefreshingId(connection.id);
      try {
        await refreshConnection(connection.id);
        runImmediateSuccess({ actionKey: 'oauth.connection.refresh', context: { displayName } });
      } catch (err) {
        runImmediateFailure({ actionKey: 'oauth.connection.refresh', err, context: { displayName } });
      } finally {
        setRefreshingId(null);
      }
    },
    [refreshingId, refreshConnection],
  );

  const handleRevokeConfirm = useCallback(async () => {
    if (revokeTarget === null) {
      return;
    }

    const displayName = resolveConnectionDisplayName(revokeTarget);
    setRevoking(true);
    try {
      await revokeConnection(revokeTarget.id);
      runImmediateSuccess({ actionKey: 'oauth.connection.revoke', context: { displayName } });
      setRevokeTarget(null);
    } catch (err) {
      runImmediateFailure({ actionKey: 'oauth.connection.revoke', err, context: { displayName } });
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, revokeConnection]);

  return (
    <TooltipProvider delayDuration={200}>
      <section className="space-y-3 rounded-lg border border-border bg-background p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-foreground">三方授权</h3>
          <p className="text-xs text-muted-foreground">
            填写各平台的应用凭据后即可发起授权。凭据与令牌落库前一律加密，接口与页面永不回显明文。
          </p>
        </div>

        {loading ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            加载中…
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            暂无可用的授权平台。
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((status) => (
              <OAuthProviderCard
                key={status.provider}
                status={status}
                connection={connectionByProvider.get(status.provider) ?? null}
                authorizing={authorizingProvider === status.provider}
                refreshingId={refreshingId}
                onSaveConfig={(input) => handleSaveConfig(status, input)}
                onClearConfig={() => handleClearConfig(status)}
                onAuthorize={() => void handleAuthorize(status)}
                onRefresh={(connection) => void handleRefresh(connection)}
                onRequestRevoke={setRevokeTarget}
              />
            ))}
          </div>
        )}
      </section>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setRevokeTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认断开授权连接</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {revokeTarget
                ? `确定断开与 ${resolveConnectionDisplayName(revokeTarget)} 的授权连接？本地保存的访问令牌会被立即删除，需要时可重新授权。`
                : '确定断开这个授权连接？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking} onClick={() => setRevokeTarget(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/92"
              onClick={(event) => {
                event.preventDefault();
                void handleRevokeConfirm();
              }}
            >
              {revoking ? '断开中…' : '确认断开'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
