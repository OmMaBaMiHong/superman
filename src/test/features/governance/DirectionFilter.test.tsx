import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovernanceQueueItem, GovernanceStats } from '@/lib/api/apiClient';
import {
  approveGovernanceItem,
  getGovernanceQueue,
  getGovernanceStats,
  listCategories,
  listDirections,
  redraftGovernanceItem,
  rejectGovernanceItem,
} from '@/lib/api/apiClient';
import GovernanceConsole from '../../../features/governance/components/GovernanceConsole';

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    getGovernanceQueue: vi.fn(),
    getGovernanceStats: vi.fn(),
    getGovernanceItemDetail: vi.fn(),
    listCategories: vi.fn(),
    listDirections: vi.fn(),
    approveGovernanceItem: vi.fn(),
    rejectGovernanceItem: vi.fn(),
    redraftGovernanceItem: vi.fn(),
  };
});

const mockedQueue = vi.mocked(getGovernanceQueue);
const mockedDirections = vi.mocked(listDirections);

const STATS: GovernanceStats = {
  todayPending: 0,
  todayArchived: 0,
  todayFetchSucceeded: 0,
  todayFetchFailed: 0,
  queueSize: 2,
};

const TEMPLATES = [
  { id: '1', userId: '1', key: 'topic', name: '选题', color: '#ef4444', icon: '🔥', keywordsDsl: '', aiHint: '', quotaWeight: 40, enabled: true, sort: 10, builtin: true },
  { id: '2', userId: '1', key: 'money', name: '搞钱', color: '#f59e0b', icon: '💰', keywordsDsl: '', aiHint: '', quotaWeight: 30, enabled: true, sort: 20, builtin: true },
];

function makeItem(overrides: Partial<GovernanceQueueItem>): GovernanceQueueItem {
  return {
    id: '1',
    title: '奏折',
    summary: null,
    aiReason: null,
    qualityScore: 60,
    feedId: 'f1',
    feedTitle: '示例源',
    categoryId: null,
    categoryTitle: null,
    publishedAt: null,
    sourceUrl: null,
    governanceStatus: 'candidate',
    redraftCount: 0,
    contentType: 'text',
    directionKey: null,
    directionReason: null,
    ...overrides,
  };
}

const ITEMS = [
  makeItem({ id: '1', title: '热点类奏折', directionKey: 'topic', directionReason: '命中关键词：热搜' }),
  makeItem({ id: '2', title: '搞钱类奏折', directionKey: 'money' }),
];

beforeEach(() => {
  mockedQueue.mockResolvedValue({ items: ITEMS, total: 2 });
  vi.mocked(getGovernanceStats).mockResolvedValue(STATS);
  vi.mocked(listCategories).mockResolvedValue([]);
  mockedDirections.mockResolvedValue({ items: TEMPLATES });
  vi.mocked(approveGovernanceItem).mockResolvedValue({});
  vi.mocked(rejectGovernanceItem).mockResolvedValue({});
  vi.mocked(redraftGovernanceItem).mockResolvedValue({});
});

describe('审批台方向筛选器（P2b）', () => {
  it('模板动态选项渲染（带色点），默认「全部方向」激活', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('热点类奏折');

    const group = screen.getByRole('group', { name: '按方向筛选' });
    const all = await screen.findByRole('button', { name: '全部方向' });
    expect(all).toHaveAttribute('aria-pressed', 'true');

    const topic = await within(group).findByRole('button', { name: /选题/ });
    const money = within(group).getByRole('button', { name: /搞钱/ });
    expect(group.contains(topic)).toBe(true);
    expect(group.contains(money)).toBe(true);
    // 色点用模板色
    expect(topic.querySelector('span')?.style.backgroundColor).toBe('rgb(239, 68, 68)');
  });

  it('选中方向后 queue 请求带 direction 参数；再点取消', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('热点类奏折');
    mockedQueue.mockClear();
    mockedQueue.mockResolvedValue({ items: [ITEMS[1]], total: 1 });

    fireEvent.click(await within(screen.getByRole('group', { name: '按方向筛选' })).findByRole('button', { name: /搞钱/ }));
    await waitFor(() => {
      expect(mockedQueue).toHaveBeenCalledWith(expect.objectContaining({ direction: 'money' }));
    });
    expect(await screen.findByText('搞钱类奏折')).toBeInTheDocument();
    expect(screen.queryByText('热点类奏折')).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: '按方向筛选' })).getByRole('button', { name: /搞钱/ }));
    await waitFor(() => {
      expect(mockedQueue).toHaveBeenCalledWith(expect.objectContaining({ direction: undefined }));
    });
  });

  it('队列条目按方向渲染徽章（模板色）', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('热点类奏折');

    await waitFor(() => {
      const badges = screen.getAllByTestId('direction-badge');
      const byDirection = badges.map((badge) => badge.getAttribute('data-direction'));
      expect(byDirection).toContain('topic');
      expect(byDirection).toContain('money');
    });
    const topicBadge = screen.getAllByTestId('direction-badge').find(
      (badge) => badge.getAttribute('data-direction') === 'topic',
    );
    expect(topicBadge?.style.color).toBe('rgb(239, 68, 68)');
  });

  it('mini 分布条按方向占比渲染，点段即筛选', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('热点类奏折');

    const bar = await screen.findByTestId('direction-distribution');
    expect(bar.querySelectorAll('button')).toHaveLength(2);

    mockedQueue.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '按方向 选题 筛选' }));
    await waitFor(() => {
      expect(mockedQueue).toHaveBeenCalledWith(expect.objectContaining({ direction: 'topic' }));
    });
  });
});
