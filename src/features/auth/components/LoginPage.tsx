'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, login } from '@/lib/api/apiClient';
import { useAuthStore } from '@/store/authStore';

export default function LoginPage() {
  const usernameLabelId = 'login-username-label';
  const passwordLabelId = 'login-password-label';
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('feedfuse-local');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');

    startTransition(() => {
      void (async () => {
        try {
          const result = await login({ username, password });
          if (result.user) {
            setCurrentUser(result.user);
          }
          window.location.assign('/');
        } catch (err) {
          if (err instanceof ApiError) {
            setErrorMessage(err.message);
            return;
          }

          setErrorMessage('登录失败，请稍后重试');
        }
      })();
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* 柔和 cyan 光斑：浅色下是玻璃台面上的反光，深色下是微弱氛围光 */}
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
                <img
                  src="/brand/logo.png"
                  alt="Superman"
                  width={56}
                  height={56}
                  className="h-14 w-14"
                />
                <span className="text-[13px] font-semibold tracking-wide text-primary">Superman</span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
                  欢迎回来
                </h1>
                <p className="text-sm text-muted-foreground">
                  登录后继续你的 RSS 阅读与管理。
                </p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label id={usernameLabelId} className="font-mono text-xs text-muted-foreground">
                  用户名
                </Label>
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  aria-labelledby={usernameLabelId}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="输入用户名"
                  aria-invalid={errorMessage ? 'true' : 'false'}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label id={passwordLabelId} className="font-mono text-xs text-muted-foreground">
                  密码
                </Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  aria-labelledby={passwordLabelId}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入密码"
                  aria-invalid={errorMessage ? 'true' : 'false'}
                  className="h-11"
                />
              </div>

              {errorMessage ? (
                <p className="rounded-md border border-error/30 bg-error/10 px-3 py-2 font-mono text-xs text-error">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="submit" className="h-11 w-full font-mono" disabled={isPending}>
                {isPending ? '登录中…' : '进入 Superman'}
              </Button>
            </form>

            <div className="flex items-center justify-center gap-2 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
              <span className="h-1 w-1 rounded-full bg-primary/70" />
              <span>个人创作指挥中心 · 私密空间</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
