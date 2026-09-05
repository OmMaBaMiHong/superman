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
      {/* 极轻微的 cyan 纵深光斑 + 网格纹理，营造指挥台氛围（透明度 ≤0.03） */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgb(34_211_238/0.03),transparent_45%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(to_right,rgb(26_37_64/0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgb(26_37_64/0.35)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <section className="rounded-lg border border-border bg-card p-6 shadow-[var(--shadow-glass)] sm:p-8">
          <div className="space-y-6">
            <div className="space-y-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <span
                  aria-hidden="true"
                  className="gov-pulse-dot h-1.5 w-1.5 rounded-full bg-primary"
                />
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
                  Superman
                </span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
                  情报指挥中心
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
                />
              </div>

              {errorMessage ? (
                <p className="rounded-md border border-error/30 bg-error/10 px-3 py-2 font-mono text-xs text-error">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="submit" className="h-10 w-full font-mono" disabled={isPending}>
                {isPending ? '登录中…' : '进入 Superman'}
              </Button>
            </form>

            <div className="flex items-center justify-center gap-2 border-t border-border/60 pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span className="h-1 w-1 rounded-full bg-primary/70" />
              <span>Mission Control · Private Workspace</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
