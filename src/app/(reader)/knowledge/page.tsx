import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/server/domains/auth/services/session';

export const metadata = {
  title: '知识库 - FeedFuse',
  description: '基于订阅源的智能知识问答',
};

/**
 * 知识库页已并入阅读器视图（ReaderApp 内左栏 Tab 切换，不再整页跳转）。
 * 本路由保留为兼容重定向（禁删文件）：旧链接/书签 `/(reader)/knowledge` → `/?view=knowledge`。
 */
export default async function KnowledgeRoute() {
  if (!(await isAuthenticated())) {
    redirect('/login');
  }

  redirect('/?view=knowledge');
}
