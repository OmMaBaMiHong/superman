import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGovernanceItemDetail, getGovernanceQueue, getGovernanceStats } from '@/lib/api/apiClient';
import H5ReaderPage from '../../h5/pages/ReaderPage';

// H5 组件经 vite alias 使用 shim；测试里显式 mock 到同一 shim
vi.mock('next/link', () => import('../../h5/shims/next-link'));
vi.mock('next/navigation', () => import('../../h5/shims/next-navigation'));

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    getGovernanceQueue: vi.fn(),
    getGovernanceItemDetail: vi.fn(),
    getGovernanceStats: vi.fn(),
  };
});

const mockedQueue = vi.mocked(getGovernanceQueue);
const mockedDetail = vi.mocked(getGovernanceItemDetail);
const mockedStats = vi.mocked(getGovernanceStats);

const ARTICLES = [
  {
    id: '1', title: '第一篇归档文章', summary: '摘要一', aiReason: null, qualityScore: 80,
    feedId: 'f1', feedTitle: '华尔街日报', categoryId: null, categoryTitle: '新闻',
    publishedAt: '2026-09-05T08:00:00Z', sourceUrl: 'https://example.com/1',
    governanceStatus: 'archived' as const, redraftCount: 0, contentType: 'image' as const,
  },
  {
    id: '2', title: '第二篇归档文章', summary: null, aiReason: null, qualityScore: null,
    feedId: 'f2', feedTitle: '微信 · 24h热文榜', categoryId: null, categoryTitle: null,
    publishedAt: null, sourceUrl: null,
    governanceStatus: 'archived' as const, redraftCount: 0, contentType: 'text' as const,
  },
];

beforeEach(() => {
  window.location.hash = '#/reader';
  mockedQueue.mockResolvedValue({ items: ARTICLES, total: 2 });
  mockedStats.mockResolvedValue({
    todayPending: 0, todayArchived: 0, todayFetchSucceeded: 0, todayFetchFailed: 0, queueSize: 0,
  });
  mockedDetail.mockResolvedValue({
    ...ARTICLES[0],
    titleOriginal: null,
    author: '作者甲',
    content: '<p>正文内容段落。</p>',
    previewImage: null,
  });
});

describe('H5 最小阅读器', () => {
  it('渲染源 chips 与文章列表，点开文章渲染正文', async () => {
    render(<H5ReaderPage />);

    expect(await screen.findByText('第一篇归档文章')).toBeInTheDocument();
    expect(screen.getByText('第二篇归档文章')).toBeInTheDocument();
    // 源 chips：全部 + 两个源
    expect(screen.getByRole('button', { name: /全部/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /华尔街日报/ })[0]).toBeInTheDocument();
    expect(mockedQueue).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['archived'] }));

    // 打开正文
    fireEvent.click(screen.getAllByTestId('reader-article-row')[0]);
    expect(await screen.findByText('正文内容段落。')).toBeInTheDocument();
    expect(mockedDetail).toHaveBeenCalledWith('1', expect.anything());
  });

  it('源筛选：点 chip 后只显示该源文章', async () => {
    render(<H5ReaderPage />);
    await screen.findByText('第一篇归档文章');

    fireEvent.click(screen.getAllByRole('button', { name: /微信 · 24h热文榜/ })[0]);
    expect(screen.queryByText('第一篇归档文章')).not.toBeInTheDocument();
    expect(screen.getByText('第二篇归档文章')).toBeInTheDocument();
  });

  it('正文打开后返回列表', async () => {
    render(<H5ReaderPage />);
    await screen.findByText('第一篇归档文章');
    fireEvent.click(screen.getAllByTestId('reader-article-row')[0]);
    await screen.findByText('正文内容段落。');

    fireEvent.click(screen.getByRole('button', { name: '返回文章列表' }));
    await waitFor(() => {
      expect(screen.getAllByTestId('reader-article-row').length).toBeGreaterThan(0);
    });
  });
});
