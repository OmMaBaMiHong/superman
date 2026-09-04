import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ArticleView from '../../../features/articles/components/ArticleView';
import { defaultPersistedSettings } from '../../../features/settings/settingsSchema';
import { useAppStore } from '../../../store/appStore';
import { useSettingsStore } from '../../../store/settingsStore';

type ApiClientModule = typeof import('@/lib/api/apiClient');

const idleTasks = {
  fulltext: { type: 'fulltext' as const, status: 'idle' as const, jobId: null, requestedAt: null, startedAt: null, finishedAt: null, attempts: 0, errorCode: null, errorMessage: null },
  ai_summary: { type: 'ai_summary' as const, status: 'idle' as const, jobId: null, requestedAt: null, startedAt: null, finishedAt: null, attempts: 0, errorCode: null, errorMessage: null },
  ai_translate: { type: 'ai_translate' as const, status: 'idle' as const, jobId: null, requestedAt: null, startedAt: null, finishedAt: null, attempts: 0, errorCode: null, errorMessage: null },
};

vi.mock('@/lib/api/apiClient', async () => {
  const actual = await vi.importActual<ApiClientModule>('@/lib/api/apiClient');
  return {
    ...actual,
    enqueueArticleFulltext: vi.fn(),
    getArticleTasks: vi.fn(),
  };
});

function setupResizeObserverMock() {
  class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);
}

async function renderVideoArticle() {
  setupResizeObserverMock();
  const apiClient = await import('@/lib/api/apiClient');
  vi.mocked(apiClient.getArticleTasks).mockResolvedValue(idleTasks);

  useSettingsStore.setState((state) => ({
    ...state,
    persistedSettings: {
      ...structuredClone(defaultPersistedSettings),
      general: {
        ...structuredClone(defaultPersistedSettings.general),
        autoMarkReadEnabled: false,
        autoMarkReadDelayMs: 0,
      },
    },
  }));

  useAppStore.setState({
    feeds: [
      {
        id: 'feed-1',
        kind: 'rss',
        title: 'Andrej Karpathy - YouTube',
        url: 'rsshub://youtube/user/@AndrejKarpathy',
        unreadCount: 0,
        enabled: true,
        fullTextOnOpenEnabled: false,
        fullTextOnFetchEnabled: false,
        aiSummaryOnOpenEnabled: false,
        aiSummaryOnFetchEnabled: false,
        bodyTranslateOnFetchEnabled: false,
        bodyTranslateOnOpenEnabled: false,
        titleTranslateEnabled: false,
        bodyTranslateEnabled: false,
        articleListDisplayMode: 'card',
        fetchStatus: null,
        fetchError: null,
      },
    ],
    articles: [
      {
        id: 'article-1',
        feedId: 'feed-1',
        title: 'How I use LLMs',
        content: '<p>Video notes stay readable below the player.</p>',
        summary: 'A video about using LLMs.',
        previewImage: 'https://i.ytimg.com/vi/zjkBMFhNj_g/hqdefault.jpg',
        publishedAt: '2026-05-16T00:00:00.000Z',
        link: 'https://www.youtube.com/watch?v=zjkBMFhNj_g',
        isRead: true,
        isStarred: false,
      },
    ],
    selectedView: 'all',
    selectedArticleId: 'article-1',
    refreshArticle: vi.fn(),
  });

  render(<ArticleView />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ArticleView video hero', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    useAppStore.setState({ articles: [], feeds: [], selectedArticleId: null });
  });

  it('renders a YouTube iframe hero for video articles', async () => {
    await renderVideoArticle();

    const hero = screen.getByTestId('article-video-hero');
    const frame = screen.getByTitle('播放视频：How I use LLMs');

    expect(hero).toBeInTheDocument();
    expect(frame).toHaveAttribute('src', 'https://www.youtube.com/embed/zjkBMFhNj_g');
    expect(screen.getByText('Video notes stay readable below the player.')).toBeInTheDocument();
  });
});
