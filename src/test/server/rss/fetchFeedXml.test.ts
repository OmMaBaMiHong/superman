import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchRssXmlMock = vi.hoisted(() => vi.fn());
const fetchEmbeddedRssHubRouteMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/infra/http/externalHttpClient', () => ({
  fetchRssXml: (...args: unknown[]) => fetchRssXmlMock(...args),
}));

vi.mock('@/server/integrations/rsshub/embeddedRssHubApp', () => ({
  fetchEmbeddedRssHubRoute: (...args: unknown[]) => fetchEmbeddedRssHubRouteMock(...args),
}));

describe('fetchFeedXml', () => {
  beforeEach(() => {
    fetchRssXmlMock.mockReset();
    fetchEmbeddedRssHubRouteMock.mockReset();
  });

  it('passes RSS logging metadata into fetchRssXml', async () => {
    fetchRssXmlMock.mockResolvedValue({
      status: 200,
      xml: '<rss />',
      etag: null,
      lastModified: null,
      finalUrl: 'https://example.com/feed.xml',
    });

    const mod = await import('@/server/integrations/rss/fetchFeedXml');
    await mod.fetchFeedXml('https://example.com/feed.xml', {
      timeoutMs: 1000,
      userAgent: 'test-agent',
    });

    expect(fetchRssXmlMock).toHaveBeenCalledWith(
      'https://example.com/feed.xml',
      expect.objectContaining({
        logging: {
          userId: null,
          source: 'server/rss/fetchFeedXml',
          requestLabel: 'RSS fetch',
          context: {
            feedUrl: 'https://example.com/feed.xml',
          },
        },
      }),
    );
  });

  it('fetches rsshub protocol feeds from embedded RSSHub without port 1200', async () => {
    fetchEmbeddedRssHubRouteMock.mockResolvedValue(
      new Response('<rss><channel><title>Andrej</title></channel></rss>', {
        status: 200,
        headers: {
          etag: '"embedded-etag"',
          'last-modified': 'Tue, 07 Jul 2026 00:00:00 GMT',
        },
      }),
    );

    const mod = await import('@/server/integrations/rss/fetchFeedXml');
    const result = await mod.fetchFeedXml('rsshub://youtube/user/@AndrejKarpathy', {
      timeoutMs: 1000,
      userAgent: 'test-agent',
      userId: '1',
    });

    expect(fetchEmbeddedRssHubRouteMock).toHaveBeenCalledWith(
      '/youtube/user/@AndrejKarpathy',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(fetchRssXmlMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 200,
      xml: '<rss><channel><title>Andrej</title></channel></rss>',
      etag: '"embedded-etag"',
      lastModified: 'Tue, 07 Jul 2026 00:00:00 GMT',
    });
  });
});
