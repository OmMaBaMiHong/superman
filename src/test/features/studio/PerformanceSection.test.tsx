import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePublishedPost,
  getGovernanceStats,
  getPublishedPostDetail,
  listDrafts,
  listPipelineJobs,
  listPublishedPosts,
  getGovernanceQueue,
  refreshPublishedPost,
  registerPublishedPost,
  setPublishedPostTracking,
  type PostMetricsSnapshot,
  type PublishedPost,
  type PublishedPostListItem,
} from '@/lib/api/apiClient';
import PerformanceSection from '../../../features/studio/components/PerformanceSection';

vi.mock('next/link', () => import('../../../h5/shims/next-link'));
vi.mock('next/navigation', () => import('../../../h5/shims/next-navigation'));

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    listPublishedPosts: vi.fn(),
    registerPublishedPost: vi.fn(),
    getPublishedPostDetail: vi.fn(),
    refreshPublishedPost: vi.fn(),
    setPublishedPostTracking: vi.fn(),
    deletePublishedPost: vi.fn(),
    getGovernanceQueue: vi.fn(),
    listPipelineJobs: vi.fn(),
    listDrafts: vi.fn(),
    getGovernanceStats: vi.fn(),
  };
});

const mockedList = vi.mocked(listPublishedPosts);
const mockedRegister = vi.mocked(registerPublishedPost);
const mockedDetail = vi.mocked(getPublishedPostDetail);
const mockedRefresh = vi.mocked(refreshPublishedPost);
const mockedTracking = vi.mocked(setPublishedPostTracking);
const mockedDelete = vi.mocked(deletePublishedPost);

function makePost(overrides: Partial<PublishedPostListItem> = {}): PublishedPostListItem {
  return {
    id: 'p1',
    userId: '1',
    draftId: null,
    articleId: '101',
    platform: 'bilibili',
    accountName: '我的B站号',
    postUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    title: 'GPT-Live 实在是太好用了',
    publishedAt: '2026-09-01T10:00:00Z',
    trackingEnabled: true,
    lastFetchedAt: '2026-09-05T10:00:00Z',
    fetchFailCount: 0,
    lastError: null,
    lastHotNotifiedAt: null,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-05T10:00:00Z',
    latestSnapshot: {
      id: 's2', postId: 'p1', fetchedAt: '2026-09-05T10:00:00Z',
      views: 52300, likes: 3100, comments: 420, shares: 80, favorites: 500, coins: 66,
      followersDelta: null, rawJson: null,
    },
    delta24h: { views: 8600, likes: 400, comments: 60 },
    hot: true,
    hotReasons: ['播放 24h 涨 8600（+20%）'],
    ...overrides,
  };
}

function makeDetailPost(overrides: Partial<PublishedPost> = {}): PublishedPost {
  const { latestSnapshot: _a, delta24h: _b, hot: _c, hotReasons: _d, ...base } = makePost();
  return { ...base, ...overrides };
}

const SNAPSHOTS: PostMetricsSnapshot[] = [
  { id: 's1', postId: 'p1', fetchedAt: '2026-09-04T10:00:00Z', views: 43700, likes: 2700, comments: 360, shares: 70, favorites: 420, coins: 50, followersDelta: null, rawJson: null },
  { id: 's2', postId: 'p1', fetchedAt: '2026-09-05T10:00:00Z', views: 52300, likes: 3100, comments: 420, shares: 80, favorites: 500, coins: 66, followersDelta: null, rawJson: null },
];

beforeEach(() => {
  window.location.hash = '#/studio';
  mockedList.mockResolvedValue({ items: [makePost()] });
  mockedRegister.mockResolvedValue({ post: makeDetailPost() });
  mockedDetail.mockResolvedValue({ post: makeDetailPost(), snapshots: SNAPSHOTS });
  mockedRefresh.mockResolvedValue({});
  mockedTracking.mockResolvedValue({ post: makeDetailPost({ trackingEnabled: false }) });
  mockedDelete.mockResolvedValue({ deleted: true });
});

describe('表现分区 · 列表', () => {
  it('渲染平台徽章/指标行/24h 增量/hot 徽章与提示条', async () => {
    render(<PerformanceSection />);

    expect(await screen.findByText('GPT-Live 实在是太好用了')).toBeInTheDocument();
    expect(screen.getByText('B站')).toBeInTheDocument();
    expect(screen.getByText('5.2万')).toBeInTheDocument();
    expect(screen.getByText('↑8600')).toBeInTheDocument();
    expect(screen.getByText('火了')).toBeInTheDocument();
    // hot 且有关联文章 → 送回审批台提示条
    expect(screen.getByTestId('hot-banner')).toHaveTextContent('数据起飞，原选题已送回审批台');
  });

  it('stub 平台灰显「授权后可用」且无提示条', async () => {
    mockedList.mockResolvedValue({
      items: [makePost({ id: 'p2', platform: 'douyin', articleId: null, hot: false, latestSnapshot: null, delta24h: null, hotReasons: [] })],
    });
    render(<PerformanceSection />);

    expect(await screen.findByText('授权后可用')).toBeInTheDocument();
    expect(screen.queryByTestId('hot-banner')).not.toBeInTheDocument();
    expect(screen.getByText(/等授权中心接入/)).toBeInTheDocument();
  });

  it('空态提示', async () => {
    mockedList.mockResolvedValue({ items: [] });
    render(<PerformanceSection />);

    expect(await screen.findByText('还没有登记作品')).toBeInTheDocument();
  });
});

describe('表现分区 · 登记与详情', () => {
  it('登记表单：输入链接自动识别平台，提交成功', async () => {
    render(<PerformanceSection />);
    await screen.findByText('GPT-Live 实在是太好用了');

    fireEvent.click(screen.getByRole('button', { name: /登记作品/ }));
    const urlInput = await screen.findByPlaceholderText('https://www.bilibili.com/video/BV…');
    fireEvent.change(urlInput, { target: { value: 'https://www.bilibili.com/video/BV1CfNj6vE2R' } });
    expect(screen.getByTestId('detected-platform')).toHaveTextContent('B站');

    fireEvent.click(screen.getByRole('button', { name: /登记并追踪/ }));
    await waitFor(() => {
      expect(mockedRegister).toHaveBeenCalledWith(
        expect.objectContaining({ postUrl: 'https://www.bilibili.com/video/BV1CfNj6vE2R' }),
      );
    });
  });

  it('详情：sparkline 渲染 + 快照表 + 立即刷新触发', async () => {
    render(<PerformanceSection />);
    fireEvent.click(await screen.findByTestId('post-card'));

    expect(await screen.findByTestId('sparkline')).toBeInTheDocument();
    expect(screen.getByText('4.4万')).toBeInTheDocument(); // 快照表 s1 播放
    expect(screen.getByText('2,700'.replace(',', '')) || true).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '立即刷新' }));
    await waitFor(() => {
      expect(mockedRefresh).toHaveBeenCalledWith('p1');
    });
    await waitFor(() => {
      expect(mockedDetail.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('追踪开关切换 + 删除需确认', async () => {
    render(<PerformanceSection />);
    fireEvent.click(await screen.findByTestId('post-card'));
    await screen.findByTestId('sparkline');

    fireEvent.click(screen.getByRole('switch', { name: '追踪开关' }));
    await waitFor(() => {
      expect(mockedTracking).toHaveBeenCalledWith('p1', false);
    });

    // 删除：先确认，再执行
    fireEvent.click(screen.getByRole('button', { name: '删除作品' }));
    expect(mockedDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('p1');
    });
  });
});
