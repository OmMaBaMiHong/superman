import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovernanceQueueItem, GovernanceStats } from '@/lib/api/apiClient';
import {
  approveGovernanceItem,
  getGovernanceQueue,
  getGovernanceStats,
  listCategories,
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
    listCategories: vi.fn(),
    approveGovernanceItem: vi.fn(),
    rejectGovernanceItem: vi.fn(),
    redraftGovernanceItem: vi.fn(),
  };
});

const mockedGetQueue = vi.mocked(getGovernanceQueue);
const mockedGetStats = vi.mocked(getGovernanceStats);
const mockedListCategories = vi.mocked(listCategories);
const mockedApprove = vi.mocked(approveGovernanceItem);
const mockedReject = vi.mocked(rejectGovernanceItem);
const mockedRedraft = vi.mocked(redraftGovernanceItem);

const STATS: GovernanceStats = {
  todayPending: 3,
  todayArchived: 12,
  todayFetchSucceeded: 45,
  todayFetchFailed: 1,
  queueSize: 2,
};

function makeItem(overrides: Partial<GovernanceQueueItem>): GovernanceQueueItem {
  return {
    id: '1',
    title: 'AI 拟折标题',
    summary: '摘要内容',
    aiReason: '收录理由：与订阅主题高度相关',
    qualityScore: 82,
    feedId: 'f1',
    feedTitle: '示例源',
    categoryId: 'c1',
    categoryTitle: '技术',
    publishedAt: '2026-04-09T08:00:00.000Z',
    sourceUrl: 'https://example.com/a1',
    governanceStatus: 'candidate',
    redraftCount: 0,
    ...overrides,
  };
}

const ITEMS: GovernanceQueueItem[] = [
  makeItem({ id: '1', title: '第一道奏折' }),
  makeItem({ id: '2', title: '第二道奏折', qualityScore: 55, aiReason: null }),
];

beforeEach(() => {
  mockedGetStats.mockResolvedValue(STATS);
  mockedListCategories.mockResolvedValue([{ id: 'c1', name: '技术', position: 0 }]);
  mockedGetQueue.mockResolvedValue({ items: ITEMS, total: 2 });
  mockedApprove.mockResolvedValue({});
  mockedReject.mockResolvedValue({});
  mockedRedraft.mockResolvedValue({});
});

describe('GovernanceConsole', () => {
  it('渲染统计条与待批队列卡片', async () => {
    render(<GovernanceConsole />);

    expect(await screen.findByText('第一道奏折')).toBeInTheDocument();
    expect(screen.getByText('第二道奏折')).toBeInTheDocument();
    expect(screen.getByText('收录理由：与订阅主题高度相关')).toBeInTheDocument();

    // 统计条数字（今日待批 3 / 队列深度 2）
    expect(screen.getByText('今日待批')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // 质量分渲染
    expect(screen.getByLabelText('质量分 82')).toBeInTheDocument();
    expect(screen.getByLabelText('质量分 55')).toBeInTheDocument();
  });

  it('准奏后调用 approve 并将卡片从列表移除', async () => {
    render(<GovernanceConsole />);
    const title = await screen.findByText('第一道奏折');

    const card = title.closest('article');
    expect(card).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /准奏/ })[0]);

    await waitFor(() => {
      expect(mockedApprove).toHaveBeenCalledWith('1');
    });
    // 卡片经滑出动效后移除
    await waitFor(
      () => {
        expect(screen.queryByText('第一道奏折')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText('第二道奏折')).toBeInTheDocument();
  });

  it('驳回：内联输入理由后 Enter 提交', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('第一道奏折');

    fireEvent.click(screen.getAllByRole('button', { name: /驳回/ })[0]);
    const input = (await screen.findAllByLabelText('驳回理由'))[0];
    fireEvent.change(input, { target: { value: '与主题无关' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockedReject).toHaveBeenCalledWith('1', { reason: '与主题无关' });
    });
    await waitFor(
      () => {
        expect(screen.queryByText('第一道奏折')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('驳回输入框 Esc 取消，不调用 API', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('第一道奏折');

    fireEvent.click(screen.getAllByRole('button', { name: /驳回/ })[0]);
    const input = (await screen.findAllByLabelText('驳回理由'))[0];
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mockedReject).not.toHaveBeenCalled();
    await waitFor(() => {
      // 取消后输入框折叠（disabled）而非弹窗关闭
      expect(screen.getAllByLabelText('驳回理由')[0]).toBeDisabled();
    });
  });

  it('快捷键：J 移动选中，A 准奏选中卡片', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('第一道奏折');

    // 初始选中第一张
    let cards = screen.getAllByTestId('gov-card');
    expect(cards[0]).toHaveAttribute('aria-selected', 'true');
    expect(cards[1]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(window, { key: 'j' });
    cards = screen.getAllByTestId('gov-card');
    expect(cards[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => {
      expect(mockedApprove).toHaveBeenCalledWith('2');
    });
  });

  it('打回重拟：提交意见后卡片进入重拟中状态且徽章 +1', async () => {
    render(<GovernanceConsole />);
    await screen.findByText('第一道奏折');

    fireEvent.click(screen.getAllByRole('button', { name: /重拟/ })[0]);
    const input = (await screen.findAllByLabelText('重拟意见'))[0];
    fireEvent.change(input, { target: { value: '标题太平' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockedRedraft).toHaveBeenCalledWith('1', { reason: '标题太平' });
    });
    expect(await screen.findByText('重拟 ×1')).toBeInTheDocument();
    // 卡片仍在列表中（状态变为 pending）
    expect(screen.getByText('第一道奏折')).toBeInTheDocument();
  });

  it('空队列显示空态提示', async () => {
    mockedGetQueue.mockResolvedValue({ items: [], total: 0 });
    render(<GovernanceConsole />);

    expect(await screen.findByText('奏折已批完，天下太平')).toBeInTheDocument();
  });
});
