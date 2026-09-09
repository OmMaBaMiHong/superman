import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAiApiKeyMock = vi.fn();
const getUiSettingsMock = vi.fn();
const listDueAiDigestConfigFeedIdsMock = vi.fn();
const getAiDigestConfigByFeedIdMock = vi.fn();
const getAiDigestRunByFeedIdAndWindowStartAtMock = vi.fn();
const createAiDigestRunMock = vi.fn();
const updateAiDigestRunMock = vi.fn();

vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getAiApiKey: (...args: unknown[]) => getAiApiKeyMock(...args),
  getUiSettings: (...args: unknown[]) => getUiSettingsMock(...args),
}));

vi.mock('@/server/domains/ai-digests/repositories/aiDigestRepo', () => ({
  listDueAiDigestConfigFeedIds: (...args: unknown[]) => listDueAiDigestConfigFeedIdsMock(...args),
  getAiDigestConfigByFeedId: (...args: unknown[]) => getAiDigestConfigByFeedIdMock(...args),
  getAiDigestRunByFeedIdAndWindowStartAt: (...args: unknown[]) =>
    getAiDigestRunByFeedIdAndWindowStartAtMock(...args),
  createAiDigestRun: (...args: unknown[]) => createAiDigestRunMock(...args),
  updateAiDigestRun: (...args: unknown[]) => updateAiDigestRunMock(...args),
}));

describe('runAiDigestTick', () => {
  beforeEach(() => {
    getAiApiKeyMock.mockReset();
    getUiSettingsMock.mockReset().mockResolvedValue({});
    listDueAiDigestConfigFeedIdsMock.mockReset();
    getAiDigestConfigByFeedIdMock.mockReset();
    getAiDigestRunByFeedIdAndWindowStartAtMock.mockReset();
    createAiDigestRunMock.mockReset();
    updateAiDigestRunMock.mockReset();
  });

  it('skips when API key is missing', async () => {
    getAiApiKeyMock.mockResolvedValue('');

    const boss = { send: vi.fn() };
    const pool = { query: vi.fn() };

    const { runAiDigestTick } = await import('../../worker/aiDigestTick');
    await runAiDigestTick({ boss: boss as never, pool: pool as never, now: new Date('2026-03-14T00:00:00.000Z') });

    expect(boss.send).not.toHaveBeenCalled();
    expect(listDueAiDigestConfigFeedIdsMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('enqueues ai.digest_generate with free mode %s', async (free) => {
    getAiApiKeyMock.mockResolvedValue(free ? '' : 'sk-test');
    getUiSettingsMock.mockResolvedValue({ ai: { providerMode: free ? 'kilo-free' : 'configured' } });
    listDueAiDigestConfigFeedIdsMock.mockResolvedValue(['feed-1']);
    getAiDigestConfigByFeedIdMock.mockResolvedValue({
      feedId: 'feed-1',
      userId: '1',
      lastWindowEndAt: '2026-03-14T00:00:00.000Z',
    });
    getAiDigestRunByFeedIdAndWindowStartAtMock.mockResolvedValue(null);
    createAiDigestRunMock.mockResolvedValue({
      id: 'run-1',
      status: 'queued',
    });

    const boss = { send: vi.fn().mockResolvedValue('job-1') };
    const pool = { query: vi.fn() };

    const { runAiDigestTick } = await import('../../worker/aiDigestTick');
    await runAiDigestTick({
      boss: boss as never,
      pool: pool as never,
      now: new Date('2026-03-14T00:01:00.000Z'),
      userId: '1',
    });

    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(createAiDigestRunMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ feedId: 'feed-1', userId: '1' }),
    );
    expect(updateAiDigestRunMock).toHaveBeenCalledWith(pool, 'run-1', {
      userId: '1',
      jobId: 'job-1',
    });
  });
});
