import { redirect } from 'next/navigation';
import GovernanceConsole from '@/features/governance/components/GovernanceConsole';
import { isAuthenticated } from '@/server/domains/auth/services/session';

export const metadata = {
  title: '审批台 - Superman',
  description: 'AI 采集内容的三省六部审批台：准奏、驳回、打回重拟',
};

export const dynamic = 'force-dynamic';

export default async function GovernancePage() {
  if (!(await isAuthenticated())) {
    redirect('/login');
  }

  return <GovernanceConsole />;
}
