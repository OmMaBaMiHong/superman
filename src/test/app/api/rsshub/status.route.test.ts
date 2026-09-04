import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureEmbeddedRssHubReadyMock = vi.fn();

vi.mock('@/server/integrations/rsshub/embeddedRssHubApp', () => ({
  ensureEmbeddedRssHubReady: (...args: unknown[]) => ensureEmbeddedRssHubReadyMock(...args),
}));

describe('/api/rsshub/status', () => {
  beforeEach(() => {
    ensureEmbeddedRssHubReadyMock.mockReset();
  });

  it('reports embedded RSSHub readiness without a baseUrl port', async () => {
    ensureEmbeddedRssHubReadyMock.mockResolvedValue(undefined);

    const mod = await import('../../../../app/api/rsshub/status/route');
    const response = await mod.GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(ensureEmbeddedRssHubReadyMock).toHaveBeenCalled();
    expect(json).toEqual({
      ok: true,
      data: {
        available: true,
        mode: 'embedded',
      },
    });
  });

  it('returns unavailable status when embedded RSSHub cannot initialize', async () => {
    ensureEmbeddedRssHubReadyMock.mockRejectedValue(new Error('Embedded RSSHub is not ready'));

    const mod = await import('../../../../app/api/rsshub/status/route');
    const response = await mod.GET();
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.ok).toBe(false);
    expect(json.data).toMatchObject({
      available: false,
      mode: 'embedded',
    });
    expect(json.error.message).toBe('Embedded RSSHub is not ready');
  });
});
