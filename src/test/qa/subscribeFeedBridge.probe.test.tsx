import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FeedList from '@/features/feeds/components/FeedList';
import {
  FEED_SUBSCRIBE_REQUEST_EVENT,
  requestSubscribeFeed,
} from '@/features/feeds/lib/subscribeFeedBridge';
import { useAppStore } from '@/store/appStore';

/**
 * QA 独立探针：订阅事件桥（推荐订阅 → FeedList）。
 * 发现入口（+ 菜单）调用 requestSubscribeFeed → dispatch CustomEvent →
 * FeedList 监听 → 预填 presetUrl/presetTitle 并打开 AddFeedDialog。
 */

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function getFetchCallUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function getFetchCallMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method;
  return init?.method ?? 'GET';
}

async function getFetchCallJsonBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  let bodyText: string | undefined;

  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      bodyText = await input.text();
    } catch {
      bodyText = undefined;
    }
  } else if (typeof init?.body === 'string') {
    bodyText = init.body;
  }

  if (!bodyText) return {};
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

function snapshotResponseFromStore() {
  const state = useAppStore.getState();
  return jsonResponse({
    ok: true,
    data: {
      categories: [],
      feeds: state.feeds.map((feed) => ({
        id: feed.id,
        provider: feed.provider ?? 'local_rss',
        remoteManaged: feed.remoteManaged ?? false,
        remoteSource: feed.remoteSource ?? null,
        title: feed.title,
        url: feed.url,
        siteUrl: feed.siteUrl ?? null,
        iconUrl: feed.icon ?? null,
        enabled: feed.enabled,
        fullTextOnOpenEnabled: Boolean(feed.fullTextOnOpenEnabled),
        aiSummaryOnOpenEnabled: Boolean(feed.aiSummaryOnOpenEnabled),
        aiSummaryOnFetchEnabled: Boolean(feed.aiSummaryOnFetchEnabled),
        bodyTranslateOnFetchEnabled: Boolean(feed.bodyTranslateOnFetchEnabled),
        bodyTranslateOnOpenEnabled: Boolean(feed.bodyTranslateOnOpenEnabled),
        titleTranslateEnabled: Boolean(feed.titleTranslateEnabled),
        bodyTranslateEnabled: Boolean(feed.bodyTranslateEnabled),
        articleListDisplayMode: feed.articleListDisplayMode ?? 'card',
        view: feed.view ?? 'article',
        categoryId: feed.categoryId ?? null,
        fetchIntervalMinutes: 30,
        lastFetchStatus: feed.fetchStatus ?? null,
        lastFetchError: feed.fetchError ?? null,
        lastFetchRawError: feed.fetchRawError ?? null,
        unreadCount: feed.unreadCount,
      })),
      articles: { items: [], nextCursor: null },
    },
  });
}

describe('QA probe: 订阅事件桥（requestSubscribeFeed → FeedList 预填 AddFeedDialog）', () => {
  beforeEach(() => {
    useAppStore.setState({
      feeds: [],
      categories: [{ id: 'cat-uncategorized', name: '未分类', expanded: true }],
      articles: [],
      selectedView: 'all',
      selectedArticleId: null,
      sidebarCollapsed: false,
      snapshotLoading: false,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = getFetchCallUrl(input);
        const method = getFetchCallMethod(input, init);

        if (url.includes('/api/reader/snapshot') && method === 'GET') {
          return snapshotResponseFromStore();
        }
        if (url.includes('/api/rss/validate') && method === 'POST') {
          const body = await getFetchCallJsonBody(input, init);
          const urlValue = String(body.url ?? '');
          return jsonResponse({ ok: true, data: { url: urlValue, title: 'Example Feed' } });
        }
        if (url.includes('/api/feeds') && method === 'POST') {
          return jsonResponse({ ok: true, data: { id: 'feed-new' } });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatch requestSubscribeFeed → FeedList 打开 AddFeedDialog 且预填 url/title', async () => {
    render(<FeedList />);

    requestSubscribeFeed('https://example.com/rss.xml', 'Example Feed');

    const dialog = await screen.findByRole('dialog', { name: '添加 RSS 源' });

    expect(dialog).toBeInTheDocument();

    const urlInput = screen.getByLabelText('URL');
    expect(urlInput).toHaveValue('https://example.com/rss.xml');
    expect(screen.getByLabelText('名称')).toHaveValue('Example Feed');
  });

  it('bridge 事件也能通过手动 CustomEvent 触发（与 ReaderContentPage 接线一致）', async () => {
    render(<FeedList />);

    window.dispatchEvent(
      new CustomEvent(FEED_SUBSCRIBE_REQUEST_EVENT, {
        detail: { url: 'https://manual.example.com/rss.xml', title: 'Manual Feed' },
      }),
    );

    await screen.findByRole('dialog', { name: '添加 RSS 源' });

    expect(screen.getByLabelText('URL')).toHaveValue('https://manual.example.com/rss.xml');
    expect(screen.getByLabelText('名称')).toHaveValue('Manual Feed');
  });

  it('无 url 的事件被忽略（不打开对话框）', async () => {
    render(<FeedList />);

    window.dispatchEvent(
      new CustomEvent(FEED_SUBSCRIBE_REQUEST_EVENT, {
        detail: { url: '', title: 'Empty' },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole('dialog', { name: '添加 RSS 源' })).not.toBeInTheDocument();
  });
});
