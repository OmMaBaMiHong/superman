import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appFetchMock = vi.hoisted(() => vi.fn());

describe('embedded RSSHub Hono app bridge', () => {
  const originalIsPackage = process.env.IS_PACKAGE;
  const originalEmbedded = process.env.RSSHUB_EMBEDDED;

  beforeEach(() => {
    vi.resetModules();
    appFetchMock.mockReset();
    delete process.env.IS_PACKAGE;
    delete process.env.RSSHUB_EMBEDDED;
    globalThis.__feedfuseImportRssHubApp = async () => ({
      default: {
        fetch: (...args: unknown[]) => appFetchMock(...args),
      },
    });
  });

  afterEach(() => {
    globalThis.__feedfuseImportRssHubApp = undefined;
    process.env.IS_PACKAGE = originalIsPackage;
    process.env.RSSHUB_EMBEDDED = originalEmbedded;
  });

  it('calls RSSHub app.fetch without opening a network port or forcing package mode', async () => {
    appFetchMock.mockResolvedValue(
      new Response('<rss />', {
        status: 200,
        headers: { 'content-type': 'application/xml; charset=utf-8' },
      }),
    );

    const mod = await import('@/server/integrations/rsshub/embeddedRssHubApp');
    const response = await mod.fetchEmbeddedRssHubRoute('/youtube/user/@AndrejKarpathy?format=atom');

    expect(appFetchMock).toHaveBeenCalledTimes(1);
    const request = appFetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('http://embedded.rsshub.local/youtube/user/@AndrejKarpathy?format=atom');
    expect(process.env.IS_PACKAGE).toBeUndefined();
    expect(process.env.RSSHUB_EMBEDDED).toBe('1');
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('<rss />');
  });
});
