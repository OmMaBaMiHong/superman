'use client';

import { useCallback, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { OAuthConnectionView, OAuthProviderConfigStatus } from '@/types';
import type { SaveOAuthProviderConfigInput } from '@/lib/api/apiClient';
import { getOAuthProviderMeta } from '../utils/oauthProviderMeta';
import OAuthConnectionBadge from './OAuthConnectionBadge';
import OAuthProviderConfigForm from './OAuthProviderConfigForm';

interface OAuthProviderCardProps {
  status: OAuthProviderConfigStatus;
  connection: OAuthConnectionView | null;
  authorizing: boolean;
  refreshingId: string | null;
  onSaveConfig: (input: SaveOAuthProviderConfigInput) => Promise<void>;
  onClearConfig: () => Promise<void>;
  onAuthorize: () => void;
  onRefresh: (connection: OAuthConnectionView) => void;
  onRequestRevoke: (connection: OAuthConnectionView) => void;
}

function formatDateTime(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 单个平台的卡片：状态 badge + 授权操作 + 可折叠的凭据配置区。
 *
 * 未配置的平台不隐藏，而是保留卡片并禁用授权按钮 + tooltip 说明原因——
 * 这是四家平台里三家在本机的默认表现，必须是明确的引导态而不是「消失」。
 */
export default function OAuthProviderCard({
  status,
  connection,
  authorizing,
  refreshingId,
  onSaveConfig,
  onClearConfig,
  onAuthorize,
  onRefresh,
  onRequestRevoke,
}: OAuthProviderCardProps) {
  // 未配置的平台默认展开配置区，用户进来就能直接填。
  const [configOpen, setConfigOpen] = useState(!status.configured);

  const meta = getOAuthProviderMeta(status.provider);
  const displayName = status.displayName || meta?.displayName || status.provider;
  const refreshing = connection !== null && refreshingId === connection.id;
  const authorizeDisabled = !status.configured || !status.enabled || authorizing;

  const authorizeDisabledReason = !status.configured
    ? '请先填写 Client ID 与 Client Secret'
    : !status.enabled
      ? '该平台已停用，请先在下方开启'
      : null;

  const handleToggleConfig = useCallback(() => {
    setConfigOpen((current) => !current);
  }, []);

  const authorizeLabel = connection === null ? '去授权' : '重新授权';

  const authorizeButton = (
    <Button
      type="button"
      size="compact"
      disabled={authorizeDisabled}
      onClick={onAuthorize}
      // disabled 元素不派发鼠标事件，tooltip 需要外层 span 承接，见下方包装。
      aria-describedby={authorizeDisabledReason ? `oauth-${status.provider}-authorize-hint` : undefined}
    >
      {authorizing ? '跳转中…' : authorizeLabel}
    </Button>
  );

  return (
    <div className="space-y-3 rounded-xl border border-border/80 bg-card/70 p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{displayName}</p>
            <OAuthConnectionBadge status={connection?.status ?? null} />
            {status.configured && !status.enabled ? (
              <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                已停用
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {meta?.summary ?? '授权后可读取该平台的基础身份信息。'}
          </p>
          {status.provider === 'github' ? (
            <p className="text-[11px] text-muted-foreground">
              也可在「GitHub 令牌」分区手动填写 PAT，两者并存不冲突。
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {authorizeDisabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* disabled 按钮本身不触发 hover，套一层 span 让 tooltip 仍可见。 */}
                <span className="inline-flex" tabIndex={0}>
                  {authorizeButton}
                </span>
              </TooltipTrigger>
              <TooltipContent id={`oauth-${status.provider}-authorize-hint`}>
                {authorizeDisabledReason}
              </TooltipContent>
            </Tooltip>
          ) : (
            authorizeButton
          )}

          {connection !== null && connection.canRefresh ? (
            <Button
              type="button"
              size="compact"
              variant="outline"
              disabled={refreshing}
              onClick={() => onRefresh(connection)}
            >
              {refreshing ? '续期中…' : '续期'}
            </Button>
          ) : null}

          {connection !== null ? (
            <Button
              type="button"
              size="compact"
              variant="outline"
              disabled={refreshing}
              onClick={() => onRequestRevoke(connection)}
            >
              断开
            </Button>
          ) : null}
        </div>
      </div>

      {connection !== null ? (
        <dl className="grid gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
          <div className="flex gap-1">
            <dt className="shrink-0">账号：</dt>
            <dd className="truncate text-foreground/80">{connection.displayName ?? '未提供昵称'}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="shrink-0">授权时间：</dt>
            <dd className="truncate">{formatDateTime(connection.authorizedAt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="shrink-0">令牌过期：</dt>
            <dd className="truncate">
              {connection.accessTokenExpiresAt === null
                ? '长期有效'
                : formatDateTime(connection.accessTokenExpiresAt)}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleToggleConfig}
          aria-expanded={configOpen}
          className="inline-flex items-center gap-1 rounded-md text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform', configOpen ? 'rotate-180' : 'rotate-0')}
            aria-hidden
          />
          {configOpen ? '收起应用配置' : '展开应用配置'}
        </button>

        {meta ? (
          <a
            href={meta.consoleUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-md text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {meta.consoleName}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>

      {configOpen ? (
        <>
          {meta && meta.tips.length > 0 ? (
            <ul className="list-disc space-y-0.5 rounded-lg bg-muted/30 px-5 py-2 text-[11px] text-muted-foreground">
              {meta.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          ) : null}
          <OAuthProviderConfigForm
            status={status}
            onSave={onSaveConfig}
            onClear={onClearConfig}
          />
        </>
      ) : null}
    </div>
  );
}
