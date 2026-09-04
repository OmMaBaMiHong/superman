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
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_42%),linear-gradient(180deg,var(--color-background)_0%,var(--color-muted)_100%)] text-foreground">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--glass-bg-light),transparent_32%,color-mix(in_oklab,var(--color-foreground)_6%,transparent))]" />
      <div className="absolute left-1/2 top-[18%] h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-primary)_22%,transparent),transparent)] blur-3xl" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <section className="rounded-[30px] border border-[var(--glass-highlight)] bg-card/85 p-6 shadow-[var(--shadow-glass)] backdrop-blur-xl sm:p-8">
          <div className="space-y-5">
            <div className="space-y-3 text-center">
              <span className="inline-flex rounded-full border border-primary/15 bg-card/70 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-primary">
                FEEDFUSE
              </span>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-[2.1rem]">
                  欢迎回来
                </h1>
                <p className="text-sm text-muted-foreground">
                  登录后继续你的 RSS 阅读与管理。
                </p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label id={usernameLabelId}>用户名</Label>
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
                <Label id={passwordLabelId}>密码</Label>
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
                <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="submit" className="h-10 w-full" disabled={isPending}>
                {isPending ? '登录中…' : '进入 FeedFuse'}
              </Button>
            </form>

            <div className="flex items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Private workspace</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
