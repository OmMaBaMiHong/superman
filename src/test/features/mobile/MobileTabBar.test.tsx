import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGovernanceStats, getUnreadNotificationCount } from '@/lib/api/apiClient';
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
    getUnreadNotificationCount: vi.fn(),
  };
});

const mockedGetStats = vi.mocked(getGovernanceStats);
const mockedUnreadCount = vi.mocked(getUnreadNotificationCount);

beforeEach(() => {
  mockPathname = '/governance';
  mockedUnreadCount.mockResolvedValue({ count: 0 });
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
    // P1-A 菜单合并：审批台并入创作，tab 收敛为 阅读/创作/热点/设置
    expect(screen.queryByRole('link', { name: '审批台' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创作' })).toHaveAttribute('href', '/studio');
    expect(screen.getByRole('link', { name: '热点' })).toHaveAttribute('href', '/trending');
    // 缺省（阅读器外）：设置跳回阅读器并消费 ?settings=open
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('href', '/?settings=open');

    const tab = screen.getByRole('link', { name: '创作' });
    expect(tab.className).toContain('min-h-[44px]');
  });

  it('按当前路由高亮激活 tab（/governance 旧路由也高亮创作）', () => {
    render(<MobileTabBar />);
    expect(screen.getByRole('link', { name: '创作' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '阅读' })).not.toHaveAttribute('aria-current');
  });

  it('创作 tab 显示待批数徽章（审批台并入后徽章迁移）', async () => {
    render(<MobileTabBar />);
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
  });

  it('待批数为 0 时不渲染徽章', async () => {
    mockedUnreadCount.mockResolvedValue({ count: 0 });
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

  it('消息 tab 指向 /notifications，未读数显示徽章（P2a 第五 tab）', async () => {
    mockedUnreadCount.mockResolvedValue({ count: 4 });
    render(<MobileTabBar />);

    expect(screen.getByRole('link', { name: '消息' })).toHaveAttribute('href', '/notifications');
    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('4');
    });
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
