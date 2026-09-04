'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { OAuthProviderConfigStatus } from '@/types';
import OAuthRedirectUriField from './OAuthRedirectUriField';
import type { SaveOAuthProviderConfigInput } from '@/lib/api/apiClient';

interface OAuthProviderConfigFormProps {
  status: OAuthProviderConfigStatus;
  onSave: (input: SaveOAuthProviderConfigInput) => Promise<void>;
  onClear: () => Promise<void>;
}

/**
 * 平台应用凭据表单：Client ID + Client Secret + 启用开关。
 *
 * Secret 的交互契约（与 `GithubTokenField` 一致）：
 * - 已配置时输入框保持为空，占位符显示打码值，**不回填明文**（后端根本不会回明文）。
 * - 留空提交 = 保留原 secret；只有真填了内容才会覆盖。
 * - 提交成功后立即清空输入框，明文在前端内存里只存活一次提交。
 */
export default function OAuthProviderConfigForm({
  status,
  onSave,
  onClear,
}: OAuthProviderConfigFormProps) {
  const [clientId, setClientId] = useState(status.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [enabled, setEnabled] = useState(status.enabled);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 服务端返回新状态后同步表单，避免显示上一次的旧值。
  useEffect(() => {
    setClientId(status.clientId);
    setEnabled(status.enabled);
    setClientSecret('');
  }, [status.clientId, status.enabled, status.maskedClientSecret]);

  const busy = saving || clearing;

  const handleSave = useCallback(async () => {
    const trimmedId = clientId.trim();
    if (trimmedId === '') {
      setError('请填写 Client ID');
      return;
    }

    const trimmedSecret = clientSecret.trim();
    if (trimmedSecret === '' && !status.configured) {
      setError('首次配置需要同时填写 Client Secret');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        clientId: trimmedId,
        // 留空 = 保留原 secret，所以此处必须省略字段而非传空串。
        ...(trimmedSecret === '' ? {} : { clientSecret: trimmedSecret }),
        enabled,
      });
      setClientSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [clientId, clientSecret, enabled, status.configured, onSave]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    setError(null);
    try {
      await onClear();
      setClientSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '清除失败，请稍后重试');
    } finally {
      setClearing(false);
    }
  }, [onClear]);

  const clientIdInputId = `oauth-${status.provider}-client-id`;
  const clientSecretInputId = `oauth-${status.provider}-client-secret`;
  const redirectUriInputId = `oauth-${status.provider}-redirect-uri`;
  const enabledSwitchId = `oauth-${status.provider}-enabled`;

  return (
    <div className="space-y-3 border-t border-border/70 pt-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={clientIdInputId}>Client ID</Label>
          <Input
            id={clientIdInputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="平台后台的应用 ID"
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              if (error) {
                setError(null);
              }
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={clientSecretInputId}>Client Secret</Label>
          <Input
            id={clientSecretInputId}
            type="password"
            autoComplete="new-password"
            placeholder={status.maskedClientSecret ?? '平台后台的应用密钥'}
            value={clientSecret}
            onChange={(event) => {
              setClientSecret(event.target.value);
              if (error) {
                setError(null);
              }
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            {status.maskedClientSecret
              ? '留空表示保留当前密钥；密钥落库即加密，永不回显明文。'
              : '密钥落库即加密，永不回显明文。'}
          </p>
        </div>
      </div>

      <OAuthRedirectUriField
        redirectUri={status.redirectUri}
        requiresExactMatch={status.requiresExactRedirectUri}
        inputId={redirectUriInputId}
      />

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id={enabledSwitchId}
            checked={enabled}
            disabled={busy}
            onCheckedChange={(next) => setEnabled(next)}
          />
          <Label htmlFor={enabledSwitchId} className="cursor-pointer text-xs text-muted-foreground">
            启用该平台
          </Label>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" size="compact" disabled={busy} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存配置'}
          </Button>
          {status.configured ? (
            <Button
              type="button"
              size="compact"
              variant="outline"
              disabled={busy}
              onClick={() => void handleClear()}
            >
              {clearing ? '清除中…' : '清除配置'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
