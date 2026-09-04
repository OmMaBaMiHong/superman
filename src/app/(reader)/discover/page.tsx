import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/server/domains/auth/services/session';

export const metadata = {
  title: '发现 - FeedFuse',
  description: '发现热门订阅源，一键订阅关注',
};

/**
 * 发现页已并入阅读器视图（ReaderApp 内左栏 Tab 切换，不再整页跳转）。
 * 本路由保留为兼容重定向（禁删文件）：旧链接/书签 `/(reader)/discover` → `/?view=discover`。
 */
export default async function DiscoverRoute() {
  if (!(await isAuthenticated())) {
    redirect('/login');
  }

  redirect('/?view=discover');
}
