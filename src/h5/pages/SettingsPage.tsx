'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { logoutH5 } from '../lib/auth';
import { navigateTo } from '../lib/router';
import MobileTabBar from '@/features/mobile/components/MobileTabBar';

/** H5 设置页（占位）：账号信息 + 登出。完整设置留在 Next 版。 */
export default function H5SettingsPage({ username }: { username: string | null }) {
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-xl px-4 pb-28 pt-8 sm:px-6">
        <h1 className="text-lg font-semibold">设置</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          H5 版提供基础账号操作；完整设置在 Next.js 版工作台。
        </p>

        <section className="glass-surface mt-5 p-5">
          <div className="flex items-center gap-3">
            <img src="/s/app/brand/logo.png" alt="" className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{username ?? '已登录'}</p>
              <p className="text-[11px] text-muted-foreground">DSH 插件伺服 · 主题跟随系统</p>
            </div>
          </div>
          <button
            type="button"
            disabled={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void logoutH5().finally(() => {
                navigateTo('/login');
                window.location.reload();
              });
            }}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-error/30 text-sm font-medium text-error transition-colors duration-150 hover:bg-error/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error disabled:opacity-50"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            退出登录
          </button>
        </section>
      </main>
      <MobileTabBar />
    </div>
  );
}
