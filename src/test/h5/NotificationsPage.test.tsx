import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getGovernanceStats,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '@/lib/api/apiClient';
import NotificationsPage from '../../h5/pages/NotificationsPage';

vi.mock('next/link', () => import('../../h5/shims/next-link'));
vi.mock('next/navigation', () => import('../../h5/shims/next-navigation'));

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    listNotifications: vi.fn(),
    getUnreadNotificationCount: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    getGovernanceStats: vi.fn(),
  };
});

const mockedList = vi.mocked(listNotifications);
const mockedUnreadCount = vi.mocked(getUnreadNotificationCount);
const mockedMarkRead = vi.mocked(markNotificationRead);
const mockedMarkAll = vi.mocked(markAllNotificationsRead);
const mockedStats = vi.mocked(getGovernanceStats);

function makeItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: '1',
    userId: '1',
    kind: 'pipeline_done',
    title: '「示例文章」改写完成',
    body: '平台：wechat，成稿已进草稿箱。',
    link: '/studio?tab=drafts',
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  window.location.hash = '#/notifications';
  mockedList.mockResolvedValue({
    items: [
      makeItem({ id: '1' }),
      makeItem({ id: '2', kind: 'fetch_failed', title: '订阅源「示例源」采集失败', body: 'timeout', link: '/reader', readAt: '2026-09-05T09:00:00Z' }),
    ],
    total: 2,
  });
  mockedUnreadCount.mockResolvedValue({ count: 1 });
  mockedMarkRead.mockResolvedValue({ item: makeItem() });
  mockedMarkAll.mockResolvedValue({ updated: 1 });
  mockedStats.mockResolvedValue({
    todayPending: 0, todayArchived: 0, todayFetchSucceeded: 0, todayFetchFailed: 0, queueSize: 0,
  });
});

describe('消息中心页', () => {
  it('按 kind 图标/标题/正文/相对时间渲染，未读有标记点', async () => {
    render(<NotificationsPage />);

    expect(await screen.findByText('「示例文章」改写完成')).toBeInTheDocument();
    expect(screen.getByText('订阅源「示例源」采集失败')).toBeInTheDocument();
    expect(screen.getByText('平台：wechat，成稿已进草稿箱。')).toBeInTheDocument();
    expect(screen.getByText('流水线')).toBeInTheDocument();
    expect(screen.getByText('采集失败')).toBeInTheDocument();

    const rows = screen.getAllByTestId('notification-row');
    expect(rows[0]).toHaveAttribute('data-unread', 'true');
    expect(rows[1]).toHaveAttribute('data-unread', 'false');
  });

  it('点击消息：标记已读（乐观灭点）并跳转 link', async () => {
    render(<NotificationsPage />);
    const row = (await screen.findAllByTestId('notification-row'))[0];

    fireEvent.click(row);

    await waitFor(() => {
      expect(mockedMarkRead).toHaveBeenCalledWith('1', expect.anything());
    });
    expect(window.location.hash).toBe('#/studio?tab=drafts');
  });

  it('全部已读：批量标记并清空未读点', async () => {
    render(<NotificationsPage />);
    await screen.findByText('「示例文章」改写完成');

    fireEvent.click(screen.getByRole('button', { name: /全部已读/ }));

    await waitFor(() => {
      expect(mockedMarkAll).toHaveBeenCalled();
    });
    await waitFor(() => {
      const rows = screen.getAllByTestId('notification-row');
      expect(rows.every((r) => r.getAttribute('data-unread') === 'false')).toBe(true);
    });
  });

  it('空态：暂无新消息', async () => {
    mockedList.mockResolvedValue({ items: [], total: 0 });
    render(<NotificationsPage />);

    expect(await screen.findByText('暂无新消息')).toBeInTheDocument();
  });
});
