import { redirect } from 'next/navigation';
import StudioConsole from '@/features/studio/components/StudioConsole';
import { isAuthenticated } from '@/server/domains/auth/services/session';

export const metadata = {
  title: '创作 - Superman',
  description: '洗稿流水线：选题池 → 多平台改写 → 草稿对照与导出',
};

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  if (!(await isAuthenticated())) {
    redirect('/login');
  }

  return <StudioConsole />;
}
