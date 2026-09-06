'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Plus, QrCode, RefreshCw } from 'lucide-react';
import {
  confirmSauLoginSession,
  createSauLoginSession,
  getSauLoginQr,
  type AccountPlatform,
  type SauLoginSessionStatus,
  type SauQrPlatform,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { cn } from '@/lib/utils';
import { ACCOUNT_PLATFORM_META } from '../lib/accountPlatforms';

const PLATFORM_IDS: AccountPlatform[] = ['wechat', 'douyin', 'xhs', 'bilibili', 'channels'];

interface AddAccountSheetProps {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    platform: AccountPlatform;
    accountName: string;
    credKind: 'app_secret' | 'cookie';
    credential: Record<string, unknown>;
  }) => void;
  /** 抖音扫码落库成功（账号已由后端写入，父级只需刷新列表并关闭）。 */
  onDouyinAdded?: () => void;
}

interface SauQrState {
  sessionId: string;
  qrSrc: string | null;
  status: SauLoginSessionStatus;
  error: string | null;
}

/** 添加平台账号 sheet：五选一平台卡片 → 按平台出对应凭据表单（明文只进不出，password 输入框）。 */
export default function AddAccountSheet({ open, submitting, onClose, onSubmit, onDouyinAdded }: AddAccountSheetProps) {
  const [platform, setPlatform] = useState<AccountPlatform>('wechat');
  const [accountName, setAccountName] = useState('');
  const [appid, setAppid] = useState('');
  const [secret, setSecret] = useState('');
  const [cookie, setCookie] = useState('');
  const [showAdvancedCookie, setShowAdvancedCookie] = useState(false);
  const [sauQr, setSauQr] = useState<SauQrState | null>(null);
  const [douyinBusy, setDouyinBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const meta = ACCOUNT_PLATFORM_META[platform];
  const isWechat = platform === 'wechat';
  const isSauQr = platform === 'douyin' || platform === 'xhs';
  const canSubmit = isWechat
    ? appid.trim() !== '' && secret.trim() !== ''
    : cookie.trim() !== '';

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // 关闭 sheet 时停止轮询；抖音会话状态在下次打开扫码流时重建。
  useEffect(() => {
    if (!open) stopPolling();
  }, [open, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const resetSauFlow = useCallback(() => {
    stopPolling();
    setSauQr(null);
    setShowAdvancedCookie(false);
  }, [stopPolling]);

  const handleStartSauQr = useCallback(() => {
    if (!isSauQr) return;
    const sauPlatform: SauQrPlatform = platform === 'xhs' ? 'xhs' : 'douyin';
    const name = accountName.trim() || `${meta.name}账号`;
    setDouyinBusy(true);
    void createSauLoginSession(sauPlatform, { accountName: name })
      .then(({ sessionId }) => {
        setSauQr({ sessionId, qrSrc: null, status: 'pending', error: null });
        stopPolling();
        pollTimer.current = setInterval(() => {
          void getSauLoginQr(sauPlatform, sessionId)
            .then(async (qr) => {
              setSauQr({ sessionId, qrSrc: qr.qrSrc, status: qr.status, error: null });
              if (qr.status === 'confirmed') {
                stopPolling();
                // 回调没到时 confirm 拉取兜底上收；成功后账号已在库里。
                await confirmSauLoginSession(sauPlatform, sessionId).catch(() => {});
                onDouyinAdded?.();
              }
              if (qr.status === 'expired') {
                stopPolling();
              }
            })
            .catch(() => {});
        }, 3000);
      })
      .catch(() => {
        setSauQr({ sessionId: '', qrSrc: null, status: 'expired', error: '登录会话创建失败，请确认执行器已启动' });
      })
      .finally(() => setDouyinBusy(false));
  }, [platform, isSauQr, meta.name, accountName, onDouyinAdded, stopPolling]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit || submitting) return;
      onSubmit({
        platform,
        accountName: accountName.trim(),
        credKind: isWechat ? 'app_secret' : 'cookie',
        credential: isWechat
          ? { appid: appid.trim(), secret: secret.trim() }
          : { cookie: cookie.trim() },
      });
    },
    [platform, accountName, appid, secret, cookie, canSubmit, submitting, isWechat, onSubmit],
  );

  return (
    <GlassDetailSheet open={open} onClose={onClose} ariaLabel="添加平台账号">
      <form className="space-y-4 px-5 pb-6 pt-1 sm:px-7" onSubmit={handleSubmit}>
        <div className="flex items-center gap-2">
          <KeyRound aria-hidden="true" className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">添加平台账号</h2>
        </div>

        {/* 平台五选一 */}
        <div role="radiogroup" aria-label="选择平台" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PLATFORM_IDS.map((id) => {
            const item = ACCOUNT_PLATFORM_META[id];
            const selected = platform === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  if (platform !== id) resetSauFlow();
                  setPlatform(id);
                }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-medium transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  selected
                    ? 'border-primary/50 bg-primary/[0.08] text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent/60',
                )}
              >
                <span aria-hidden="true" className="text-lg">{item.icon}</span>
                {item.name}
              </button>
            );
          })}
        </div>

        {/* 公众号：appid + secret */}
        {isWechat ? (
          <div className="space-y-2.5">
            <div className="space-y-1.5">
              <label htmlFor="wechat-appid" className="text-xs font-medium text-muted-foreground">AppID</label>
              <input
                id="wechat-appid"
                type="password"
                autoComplete="off"
                value={appid}
                onChange={(event) => setAppid(event.target.value)}
                placeholder="wx 开头的应用 ID"
                className="h-11 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wechat-secret" className="text-xs font-medium text-muted-foreground">AppSecret</label>
              <input
                id="wechat-secret"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="应用密钥"
                className="h-11 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              获取路径：公众平台 → 设置与开发 → 基本配置 → 公众号开发信息。
              凭据加密落库，只显示脱敏值，永不回显明文。
            </p>
          </div>
        ) : isSauQr ? (
          <div className="space-y-3">
            {/* 抖音：扫码授权（主路径） */}
            <div className="rounded-2xl border border-border/70 bg-card/60 p-3.5">
              <div className="flex items-center gap-2">
                <QrCode aria-hidden="true" className="h-4 w-4 text-primary" />
                <p className="text-xs font-medium text-foreground">手机{meta.name}扫码授权</p>
              </div>
              {sauQr ? (
                <div className="mt-3 space-y-2.5">
                  {sauQr.qrSrc ? (
                    // 原生 img：二维码来自执行器（data-url 或抖音 CDN），next/image 不适用
                    <img
                      src={sauQr.qrSrc}
                      alt={`${meta.name}登录二维码`}
                      className="mx-auto h-44 w-44 rounded-xl border border-border bg-white object-contain"
                    />
                  ) : (
                    <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-xl border border-dashed border-border text-[11px] text-muted-foreground">
                      {sauQr.status === 'expired' ? '二维码已过期' : '二维码生成中…'}
                    </div>
                  )}
                  <p className="text-center text-[11px] text-muted-foreground" role="status">
                    {sauQr.error
                      ? sauQr.error
                      : sauQr.status === 'confirmed'
                        ? '已扫码确认，正在落库…'
                        : sauQr.status === 'expired'
                          ? '二维码已过期，请重新生成'
                          : `打开${meta.name} App 扫码，3 秒自动刷新状态`}
                  </p>
                  {sauQr.status === 'expired' ? (
                    <button
                      type="button"
                      onClick={handleStartSauQr}
                      className="mx-auto flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                      重新生成二维码
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={douyinBusy}
                  onClick={handleStartSauQr}
                  className={cn(
                    'mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10',
                    'text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.98]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <QrCode aria-hidden="true" className="h-4 w-4" />
                  {douyinBusy ? '正在生成二维码…' : '生成登录二维码'}
                </button>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                登录态 cookie 加密上收，扫码成功后自动出现在账号列表。
              </p>
            </div>

            {/* 高级选项：手动粘贴 cookie */}
            <details
              className="rounded-2xl border border-border/70 bg-card/60 px-3.5 py-2.5"
              open={showAdvancedCookie}
              onToggle={(event) => setShowAdvancedCookie(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                高级选项：手动粘贴 Cookie
              </summary>
              <div className="mt-2.5 space-y-1.5">
                <textarea
                  id="sau-cookie"
                  rows={3}
                  value={cookie}
                  onChange={(event) => setCookie(event.target.value)}
                  placeholder="从浏览器开发者工具复制完整 Cookie 串"
                  className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </details>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="platform-cookie" className="text-xs font-medium text-muted-foreground">
              登录 Cookie
            </label>
            <textarea
              id="platform-cookie"
              rows={4}
              value={cookie}
              onChange={(event) => setCookie(event.target.value)}
              placeholder="从浏览器开发者工具复制完整 Cookie 串"
              className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {meta.name}发布能力待 P2e-3 开放，可先保存凭据，「验证连通」会提示待支持。
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="account-name" className="text-xs font-medium text-muted-foreground">账号名</label>
          <input
            id="account-name"
            type="text"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder={`给这个${meta.name}账号起个名字`}
            className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            取消
          </button>
          {/* 扫码平台走扫码流时无需手动保存；仅高级 cookie 路径或其他平台显示 */}
          {(!isSauQr || showAdvancedCookie) ? (
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5',
                'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {submitting ? '保存中…' : '保存账号'}
            </button>
          ) : null}
        </div>
      </form>
    </GlassDetailSheet>
  );
}
