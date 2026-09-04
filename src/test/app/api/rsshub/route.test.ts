import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchEmbeddedRssHubRouteMock = vi.fn();

vi.mock('@/server/integrations/rsshub/embeddedRssHubApp', () => ({
  fetchEmbeddedRssHubRoute: (...args: unknown[]) => fetchEmbeddedRssHubRouteMock(...args),
}));

describe('/api/rsshub/[...route]', () => {
  beforeEach(() => {
    fetchEmbeddedRssHubRouteMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('returns the native embedded RSSHub response without fetching port 1200', async () => {
    const globalFetchMock = vi.fn();
    vi.stubGlobal('fetch', globalFetchMock);
    fetchEmbeddedRssHubRouteMock.mockResolvedValue(
      new Response('<rss />', {
        status: 200,
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          etag: '"rsshub-etag"',
        },
      }),
    );

    const mod = await import('../../../../app/api/rsshub/[...route]/route');
    const response = await mod.GET(
      new Request('http://localhost/api/rsshub/youtube/user/@AndrejKarpathy?format=atom'),
      { params: Promise.resolve({ route: ['youtube', 'user', '@AndrejKarpathy'] }) },
    );

    expect(fetchEmbeddedRssHubRouteMock).toHaveBeenCalledWith(
      '/youtube/user/@AndrejKarpathy?format=atom',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(globalFetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(response.headers.get('etag')).toBe('"rsshub-etag"');
    await expect(response.text()).resolves.toBe('<rss />');
  });
});
