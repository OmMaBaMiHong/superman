import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGovernanceStats } from '@/lib/api/apiClient';
import MobileTabBar from '../../../features/mobile/components/MobileTabBar';

let mockPathname = '/governance';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    getGovernanceStats: vi.fn(),
  };
});

const mockedGetStats = vi.mocked(getGovernanceStats);

beforeEach(() => {
  mockPathname = '/governance';
  mockedGetStats.mockResolvedValue({
    todayPending: 2,
    todayArchived: 5,
    todayFetchSucceeded: 30,
    todayFetchFailed: 0,
    queueSize: 7,
  });
});

describe('MobileTabBar（移动端底部导航）', () => {
  it('渲染 阅读/审批台/热点/设置 四个入口，触控目标 ≥44px', async () => {
    render(<MobileTabBar />);

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '阅读' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '审批台' })).toHaveAttribute('href', '/governance');
    expect(screen.getByRole('link', { name: '热点' })).toHaveAttribute('href', '/trending');
    // 缺省（阅读器外）：设置跳回阅读器并消费 ?settings=open
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('href', '/?settings=open');

    const tab = screen.getByRole('link', { name: '审批台' });
    expect(tab.className).toContain('min-h-[44px]');
  });

  it('按当前路由高亮激活 tab', () => {
    render(<MobileTabBar />);
    expect(screen.getByRole('link', { name: '审批台' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '阅读' })).not.toHaveAttribute('aria-current');
  });

  it('审批台 tab 显示待批数徽章', async () => {
    render(<MobileTabBar />);
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
  });

  it('待批数为 0 时不渲染徽章', async () => {
    mockedGetStats.mockResolvedValue({
      todayPending: 0,
      todayArchived: 0,
      todayFetchSucceeded: 0,
      todayFetchFailed: 0,
      queueSize: 0,
    });
    render(<MobileTabBar />);
    await waitFor(() => {
      expect(mockedGetStats).toHaveBeenCalled();
    });
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('阅读器内传入 onOpenSettings 时渲染按钮而非链接', () => {
    const onOpenSettings = vi.fn();
    render(<MobileTabBar onOpenSettings={onOpenSettings} />);

    const button = screen.getByRole('button', { name: '设置' });
    expect(screen.queryByRole('link', { name: '设置' })).not.toBeInTheDocument();
    button.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
