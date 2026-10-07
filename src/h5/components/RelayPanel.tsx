'use client';

import { Check, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  getRelayStatus, relayLogin, relayLogout, relaySync,
  selectRelayKeyId, selectRelayModelId, listRelayModels, saveRelayConfig,
  type RelayStatus,
} from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';

/**
 * 「中转站会员」面板（P2e-6 relay 一期）：
 * - 网页端 / DSH 插件端统一账密授权登录（token 加密落库，面板只回显尾 4 位）；
 * - 会员卡（套餐/到期/权益）来自登录对账快照（5min TTL，可手动同步）；
 * - Key 选择（中转站是钥匙唯一源头，拉已有 key 让用户选）与模型选择；
 * - 中转站地址可配置（service_config.relay，可修改）。
 */
export default function RelayPanel() {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [models, setModels] = useState<Array<{ id: string; name?: string }>>([]);

  const load = useCallback(async () => {
    try {
      const s = await getRelayStatus({ notifyOnError: false });
      setStatus(s);
      setApiUrl(s.endpoints.apiUrl);
    } catch {
      // 静默
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleLogin = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) { toast.info('请输入中转站邮箱与密码'); return; }
    setBusy('login');
    try {
      const r = await relayLogin({ email: email.trim(), password });
      toast.success(r.isMember ? `授权成功，会员套餐：${r.plan ?? '生效中'}` : '授权成功（当前无生效中的付费订阅）');
      setPassword('');
      await load();
    } catch {
      // apiClient 已统一 toast
    } finally {
      setBusy(null);
    }
  }, [email, password, load]);

  const handleLogout = useCallback(async () => {
    setBusy('logout');
    try {
      await relayLogout();
      toast.success('已退出中转站授权');
      await load();
    } finally { setBusy(null); }
  }, [load]);

  const handleSync = useCallback(async () => {
    setBusy('sync');
    try {
      const r = await relaySync();
      toast.success(r.isMember ? `会员有效：${r.plan ?? '生效中'}` : '名下暂无生效中的付费订阅');
      await load();
    } catch {
      // apiClient 已统一 toast
    } finally { setBusy(null); }
  }, [load]);

  const handleSelectKey = useCallback(async (keyId: string) => {
    setBusy('key');
    try {
      await selectRelayKeyId(keyId);
      toast.success('已切换 Key');
      await load();
    } catch {
      // apiClient 已统一 toast
    } finally { setBusy(null); }
  }, [load]);

  const handleSelectModel = useCallback(async (model: string) => {
    setBusy('model');
    try {
      await selectRelayModelId(model);
      toast.success(`默认模型已设为 ${model}`);
      await load();
    } catch {
      // apiClient 已统一 toast
    } finally { setBusy(null); }
  }, [load]);

  const handleLoadModels = useCallback(async () => {
    setBusy('models');
    try {
      const r = await listRelayModels();
      setModels(r.items);
      if (r.items.length === 0) toast.info('中转站未返回模型列表');
    } catch {
      // apiClient 已统一 toast
    } finally { setBusy(null); }
  }, []);

  const handleSaveEndpoint = useCallback(async () => {
    if (!apiUrl.trim()) { toast.info('中转站地址不能为空'); return; }
    setBusy('config');
    try {
      await saveRelayConfig({ apiUrl: apiUrl.trim() });
      toast.success('中转站地址已保存');
      await load();
    } catch {
      // apiClient 已统一 toast
    } finally { setBusy(null); }
  }, [apiUrl, load]);

  if (!status) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-3" data-testid="relay-panel">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">中转站状态加载中…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-secondary/40 p-3.5" data-testid="relay-panel">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground">🌐 中转站会员</p>
        {status.loggedIn ? (
          <span className={cn(
            'rounded-full border px-2 py-px text-[10px] font-medium',
            status.isMember ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground',
          )}>
            {status.isMember ? `会员 · ${status.plan ?? '生效中'}` : '无生效订阅'}
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {status.loggedIn
          ? `授权账号：${String((status.user as { username?: string; email?: string } | null)?.username ?? (status.user as { email?: string } | null)?.email ?? '已登录')}${status.expiresAt ? ` · 到期 ${status.expiresAt.slice(0, 10)}` : ''}`
          : '授权登录中转站后，洗稿 / 媒体生成 / 知识库问答等会员功能即刻可用'}
      </p>

      {!status.loggedIn ? (
        <form className="space-y-2" onSubmit={(e) => void handleLogin(e)}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="中转站邮箱"
            aria-label="中转站邮箱"
            autoComplete="username"
            required
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="中转站密码"
            aria-label="中转站密码"
            autoComplete="current-password"
            required
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
          />
          <div className="flex gap-2">
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="中转站地址"
              aria-label="中转站地址"
              className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 font-mono text-xs text-foreground focus-visible:border-primary focus-visible:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSaveEndpoint()}
              className="h-10 shrink-0 rounded-xl border border-border px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              存地址
            </button>
          </div>
          <button
            type="submit"
            disabled={busy === 'login'}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy === 'login' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            授权登录
          </button>
        </form>
      ) : (
        <div className="space-y-2.5">
          {/* 权益点 */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(status.entitlementCatalog).map(([point, label]) => {
              const owned = status.entitlements.includes(point);
              return (
                <span
                  key={point}
                  className={cn(
                    'rounded-full border px-2 py-px text-[10px]',
                    owned ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground/70',
                  )}
                  title={owned ? '已拥有' : '需要会员'}
                >
                  {owned ? '✓ ' : '🔒 '}{label}
                </span>
              );
            })}
          </div>

          {/* Key 选择 */}
          {status.keys.length > 0 ? (
            <div className="space-y-1.5">
              <p className="px-1 text-[11px] font-medium text-muted-foreground">我的 Key</p>
              {status.keys.map((k) => (
                <div key={k.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {k.name} · ****{k.last4}
                    {k.groupName ? <span className="ml-1.5 text-[10px] text-muted-foreground">{k.groupName}</span> : null}
                  </span>
                  {k.selected ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-px text-[10px] text-success">
                      <Check className="h-3 w-3" aria-hidden="true" />使用中
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === 'key'}
                      onClick={() => void handleSelectKey(k.id)}
                      className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] text-primary disabled:opacity-50"
                    >
                      使用
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-warning/10 px-3 py-2 text-[11px] text-warning">
              名下暂无生效中的 Key——请到中转站面板创建后点「同步」。
            </p>
          )}

          {/* 模型选择 */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] text-muted-foreground">默认模型</span>
            <span className="min-w-0 flex-1 truncate rounded-xl border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground">
              {status.selectedModel}
            </span>
            <button
              type="button"
              onClick={() => void handleLoadModels()}
              disabled={busy === 'models'}
              className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary disabled:opacity-50"
            >
              {busy === 'models' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : '拉取'}
            </button>
          </div>
          {models.length > 0 ? (
            <div className="max-h-36 overflow-y-auto rounded-xl border border-border/60 bg-card/60 p-1.5">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void handleSelectModel(m.id)}
                  className={cn(
                    'block w-full truncate rounded-lg px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors',
                    m.id === status.selectedModel ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {m.name ?? m.id}
                </button>
              ))}
            </div>
          ) : null}

          {/* 操作行 */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={busy === 'sync'}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 text-xs font-medium text-primary disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', busy === 'sync' && 'animate-spin')} aria-hidden="true" />
              同步会员状态
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={busy === 'logout'}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-error/30 text-xs font-medium text-error disabled:opacity-50"
            >
              <LogOut className="h-3 w-3" aria-hidden="true" />
              退出授权
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
