import { beforeEach, describe, expect, it, vi } from 'vitest';

const backfillMock = vi.fn(async () => ({ scanned: 0, indexed: 0, failed: 0, remaining: null }));
const getAiApiKeyMock = vi.fn(async () => 'sk-test');
const getAppSettingsMock = vi.fn(async () => ({ aiModel: 'm', aiApiBaseUrl: 'http://ai' }));

vi.mock('@/core/knowledge/backfill', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/knowledge/backfill')>();
  return { ...original, backfillKnowledge: (...a: unknown[]) => backfillMock(...a) };
});
vi.mock('@/core/auth/usersRepo', () => ({
  listUsers: vi.fn(async () => [{ id: '1', status: 'active' }]),
}));
vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: vi.fn(async () => ({})),
  getAiApiKey: (...a: unknown[]) => getAiApiKeyMock(...a),
  getAppSettings: (...a: unknown[]) => getAppSettingsMock(...a),
}));

import { startPluginScheduler } from '@/plugin/host/jobs/scheduler';

const fakePool = { query: vi.fn(async () => ({ rows: [] })) };
const logger = { log: () => {}, warn: () => {} };

describe('plugin/host/scheduler · knowledge.backfill（P2f-A4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiApiKeyMock.mockResolvedValue('sk-test');
  });

  it('AI 配置完整时按批回填', async () => {
    vi.useFakeTimers();
    try {
      backfillMock.mockResolvedValue({ scanned: 20, indexed: 18, failed: 2, remaining: 35 });
      const scheduler = startPluginScheduler(
        fakePool as never,
        { schedulerEnabled: true, knowledgeBackfillIntervalMs: 100 },
        logger,
      );
      await vi.advanceTimersByTimeAsync(150);
      expect(backfillMock).toHaveBeenCalledWith(fakePool, expect.objectContaining({ limit: 20 }));
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AI 未配置时跳过（零成本）', async () => {
    vi.useFakeTimers();
    try {
      getAiApiKeyMock.mockResolvedValue('');
      const scheduler = startPluginScheduler(
        fakePool as never,
        { schedulerEnabled: true, knowledgeBackfillIntervalMs: 100 },
        logger,
      );
      await vi.advanceTimersByTimeAsync(150);
      expect(backfillMock).not.toHaveBeenCalled();
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
