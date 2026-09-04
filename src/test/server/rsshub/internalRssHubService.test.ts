import { describe, expect, it } from 'vitest';

describe('internal RSSHub compatibility service', () => {
  it('exports embedded RSSHub helpers without child-process startup', async () => {
    const mod = await import('@/server/integrations/rsshub/internalRssHubService');

    expect(mod.ensureInternalRssHubAvailable).toBeTypeOf('function');
    expect(mod.fetchEmbeddedRssHubRoute).toBeTypeOf('function');
  });
});
