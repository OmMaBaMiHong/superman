import { redirect } from 'next/navigation';
import TrendingConsole from '@/features/trending/components/TrendingConsole';
import { isAuthenticated } from '@/server/domains/auth/services/session';

export const metadata = {
  title: '热点雷达 - Superman',
  description: 'TrendRadar 十一平台热榜：按平台分组，一键转为选题进审批台',
};

export const dynamic = 'force-dynamic';

export default async function TrendingPage() {
  if (!(await isAuthenticated())) {
    redirect('/login');
  }

  return <TrendingConsole />;
}
