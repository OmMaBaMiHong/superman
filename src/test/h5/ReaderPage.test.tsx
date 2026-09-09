import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api/apiClient';
import H5ReaderPage from '../../h5/pages/ReaderPage';

vi.mock('@/features/mobile/components/MobileTabBar', () => ({ default: () => <nav>底部导航</nav> }));
vi.mock('@/h5/components/FeedsManagerSheet', () => ({ default: () => null }));
vi.mock('@/lib/api/apiClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/apiClient')>(),
  getGovernanceQueue: vi.fn(async () => ({ items: [], total: 0 })),
  listSubscriptionFeeds: vi.fn(), listSubscriptionWorks: vi.fn(), getSubscriptionWork: vi.fn(),
  markSubscriptionWorkRead: vi.fn(), addSubscriptionCandidate: vi.fn(),
}));

const feeds = [
  { id: '1', title: '博主甲', url: 'https://example.com/rss', siteUrl: 'https://example.com', iconUrl: null, enabled: true, articleCount: 2, unreadCount: 2, newestId: '12', latestTitle: '第一篇文章', latestPublishedAt: '2026-09-09T08:00:00Z', lastFetchStatus: 200, lastFetchError: null, lastFetchedAt: null },
  { id: '2', title: '零作品博主', url: 'https://empty.example/rss', siteUrl: null, iconUrl: null, enabled: true, articleCount: 0, unreadCount: 0, newestId: null, latestTitle: null, latestPublishedAt: null, lastFetchStatus: 503, lastFetchError: '订阅源暂时不可用', lastFetchedAt: null },
];
const work = { id: '11', feedId: '1', feedTitle: '博主甲', title: '第一篇文章', summary: '文章摘要', sourceUrl: 'https://example.com/11', publishedAt: '2026-09-09T08:00:00Z', previewImage: null, author: '作者甲', isRead: false, governanceStatus: 'candidate', inCandidatePool: false, contentType: 'text' as const };

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '#/reader');
  vi.mocked(api.listSubscriptionFeeds).mockResolvedValue({ items: structuredClone(feeds) });
  vi.mocked(api.listSubscriptionWorks).mockResolvedValue({ items: [structuredClone(work)], nextCursor: null });
  vi.mocked(api.getSubscriptionWork).mockResolvedValue({ item: { ...work, content: '<p>作品正文</p>', mediaAttachments: [] } });
  vi.mocked(api.markSubscriptionWorkRead).mockResolvedValue({ updated: true });
  vi.mocked(api.addSubscriptionCandidate).mockResolvedValue({ inCandidatePool: true });
});

async function openFeed() {
  fireEvent.click(await screen.findByRole('button', { name: /打开博主：博主甲/ }));
  await screen.findByTestId('reader-article-row');
}

describe('DSH 订阅阅读', () => {
  it('shows subscribed bloggers without works, and explains fetch failures', async () => {
    render(<H5ReaderPage />);
    expect(await screen.findByText('零作品博主')).toBeInTheDocument();
    expect(screen.getByText('订阅源暂时不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开博主：博主甲/ })).toHaveTextContent('2');
  });

  it('opens blogger works by id, then content, marks read, and returns without losing the list', async () => {
    render(<H5ReaderPage />);
    await openFeed();
    expect(api.listSubscriptionWorks).toHaveBeenCalledWith(expect.objectContaining({ feedId: '1', type: 'all' }), expect.anything());
    fireEvent.click(screen.getByTestId('reader-article-row'));
    expect(await screen.findByText('作品正文')).toBeInTheDocument();
    await waitFor(() => expect(api.markSubscriptionWorkRead).toHaveBeenCalledWith('11', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: '返回作品列表' }));
    expect(screen.getByTestId('reader-article-row')).toBeInTheDocument();
  });

  it('keeps a work in reading after manual selection and prevents duplicate additions', async () => {
    render(<H5ReaderPage />);
    await openFeed();
    fireEvent.click(screen.getByRole('button', { name: '加入候选池：第一篇文章' }));
    expect(await screen.findByRole('button', { name: '已加入候选池：第一篇文章' })).toBeDisabled();
    expect(screen.getByTestId('reader-article-row')).toBeInTheDocument();
    expect(api.addSubscriptionCandidate).toHaveBeenCalledTimes(1);
  });

  it('loads further pages and applies video filters on the server', async () => {
    vi.mocked(api.listSubscriptionWorks).mockResolvedValueOnce({ items: [work], nextCursor: 'page2' })
      .mockResolvedValueOnce({ items: [{ ...work, id: '12', title: '下一页作品' }], nextCursor: null });
    render(<H5ReaderPage />);
    await openFeed();
    fireEvent.click(screen.getByRole('button', { name: '加载更多作品' }));
    expect(await screen.findByText('下一页作品')).toBeInTheDocument();
    expect(api.listSubscriptionWorks).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'page2' }), expect.anything());
    fireEvent.click(screen.getByRole('button', { name: '视频' }));
    await waitFor(() => expect(api.listSubscriptionWorks).toHaveBeenCalledWith(expect.objectContaining({ type: 'video' }), expect.anything()));
  });

  it('renders an error and retry instead of an endless detail skeleton', async () => {
    vi.mocked(api.getSubscriptionWork).mockRejectedValueOnce(new Error('网络异常'));
    render(<H5ReaderPage />);
    await openFeed();
    fireEvent.click(screen.getByTestId('reader-article-row'));
    expect(await screen.findByText('作品加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载作品' }));
    expect(await screen.findByText('作品正文')).toBeInTheDocument();
  });

  it('shows a direct video attachment in the detail player', async () => {
    vi.mocked(api.getSubscriptionWork).mockResolvedValue({ item: { ...work, contentType: 'video', content: '视频介绍', mediaAttachments: [{ id: '1', url: 'https://example.com/video.mp4', mimeType: 'video/mp4', durationSeconds: 60 }] } });
    render(<H5ReaderPage />);
    await openFeed();
    fireEvent.click(screen.getByTestId('reader-article-row'));
    expect(await screen.findByLabelText('播放：第一篇文章')).toHaveAttribute('src', 'https://example.com/video.mp4');
  });

  it('announces arrivals without replacing the current list until requested', async () => {
    render(<H5ReaderPage />);
    await openFeed();
    fireEvent.click(screen.getByTestId('reader-article-row'));
    await screen.findByText('作品正文');
    await waitFor(() => expect(api.markSubscriptionWorkRead).toHaveBeenCalled());
    vi.mocked(api.listSubscriptionFeeds).mockResolvedValue({ items: [{ ...feeds[0], articleCount: 3, newestId: '13' }, feeds[1]] });
    fireEvent.click(screen.getByRole('button', { name: '刷新阅读列表' }));
    expect(await screen.findByRole('button', { name: '有 1 条新作品，点击更新' })).toBeInTheDocument();
    expect(api.listSubscriptionWorks).toHaveBeenCalledTimes(1);
    expect(screen.getByText('作品正文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回作品列表' }));
    fireEvent.click(screen.getByRole('button', { name: '有 1 条新作品，点击更新' }));
    await waitFor(() => expect(api.listSubscriptionWorks).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: '有 1 条新作品，点击更新' })).not.toBeInTheDocument());
  });
});
