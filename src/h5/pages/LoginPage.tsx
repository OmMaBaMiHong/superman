'use client';

import { useState, useTransition } from 'react';
import { loginH5 } from '../lib/auth';
import { navigateTo } from '../lib/router';

/** H5 登录页：液态玻璃品牌位 + /s/api/auth/login。 */
export default function H5LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    startTransition(() => {
      void (async () => {
        const result = await loginH5(username, password);
        if (result.ok) {
          navigateTo('/governance');
          window.location.reload();
          return;
        }
        setErrorMessage(result.error ?? '登录失败，请稍后重试');
      })();
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,color-mix(in_oklab,var(--color-primary)_8%,transparent),transparent_45%)]"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[16%] h-64 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-primary)_10%,transparent),transparent)] blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <section className="glass-surface-strong p-6 sm:p-8">
          <div className="space-y-6">
            <div className="space-y-4 text-center">
              <div className="flex flex-col items-center gap-2.5">
                <img src="/s/app/brand/logo.png" alt="Superman" width={56} height={56} className="h-14 w-14" />
                <span className="text-[13px] font-semibold tracking-wide text-primary">Superman</span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">欢迎回来</h1>
                <p className="text-sm text-muted-foreground">登录后进入你的创作指挥中心。</p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label htmlFor="h5-login-username" className="text-xs font-medium text-muted-foreground">
                  用户名
                </label>
                <input
                  id="h5-login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="输入用户名"
                  aria-invalid={errorMessage ? 'true' : 'false'}
                  className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="h5-login-password" className="text-xs font-medium text-muted-foreground">
                  密码
                </label>
                <input
                  id="h5-login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入密码"
                  aria-invalid={errorMessage ? 'true' : 'false'}
                  className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {errorMessage ? (
                <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                  {errorMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isPending}
                className="h-11 w-full rounded-full bg-primary text-sm font-medium text-primary-foreground transition-all duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {isPending ? '登录中…' : '进入 Superman'}
              </button>
            </form>

            <div className="flex items-center justify-center gap-2 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
              <span className="gov-pulse-dot h-1 w-1 rounded-full bg-primary/70" />
              <span>DSH 插件伺服 · 私密空间</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
