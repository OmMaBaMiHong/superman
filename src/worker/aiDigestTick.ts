import { resolveAiConfigFingerprints } from '@/server/integrations/ai/configFingerprints';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import {
  createAiDigestRun,
  getAiDigestConfigByFeedId,
  getAiDigestRunByFeedIdAndWindowStartAt,
  listDueAiDigestConfigFeedIds,
  updateAiDigestRun,
} from '@/server/domains/ai-digests/repositories/aiDigestRepo';
import { getQueueSendOptions } from '@/server/infra/queue/contracts';
import { JOB_AI_DIGEST_GENERATE } from '@/server/infra/queue/jobs';

export async function runAiDigestTick(deps: {
  pool: { query: (...args: unknown[]) => unknown };
  boss: {
    send: (
      name: string,
      data?: object | null,
      // pg-boss send options shape differs between builds; keep it permissive.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options?: any,
    ) => unknown;
  };
  now?: Date;
  userId?: string;
}) {
  const now = deps.now ?? new Date();

  const [aiApiKey, uiSettings] = await Promise.all([
    getAiApiKey(deps.pool as never, deps.userId),
    getUiSettings(deps.pool as never, deps.userId),
  ]);
  if (!aiApiKey.trim() && normalizePersistedSettings(uiSettings).ai.providerMode !== 'kilo-free') {
    return;
  }
  const { shared: sharedConfigFingerprint } = resolveAiConfigFingerprints({
    settings: uiSettings,
    aiApiKey,
    translationApiKey: '',
  });

  const dueFeedIds = await listDueAiDigestConfigFeedIds(deps.pool as never, {
    now,
    userId: deps.userId,
  });

  for (const feedId of dueFeedIds) {
    const config = await getAiDigestConfigByFeedId(deps.pool as never, feedId, deps.userId);
    if (!config) continue;

    const windowStartAt = config.lastWindowEndAt;
    const windowEndAt = now.toISOString();

    const existing = await getAiDigestRunByFeedIdAndWindowStartAt(deps.pool as never, {
      feedId,
      userId: config.userId,
      windowStartAt,
    });
    if (existing && (existing.status === 'queued' || existing.status === 'running' || existing.status === 'failed')) {
      continue;
    }
    if (existing) {
      continue;
    }

    const created = await createAiDigestRun(deps.pool as never, {
      feedId,
      userId: config.userId,
      windowStartAt,
      windowEndAt,
      status: 'queued',
    });

    if (!created) continue;

    const jobIdRaw = await deps.boss.send(
      JOB_AI_DIGEST_GENERATE,
      { userId: config.userId, runId: created.id, sharedConfigFingerprint },
      getQueueSendOptions(JOB_AI_DIGEST_GENERATE, {
        userId: config.userId,
        runId: created.id,
      }),
    );

    const jobId =
      typeof jobIdRaw === 'string' || typeof jobIdRaw === 'number' ? String(jobIdRaw) : null;

    if (jobId && jobId.trim()) {
      await updateAiDigestRun(deps.pool as never, created.id, {
        userId: config.userId,
        jobId: jobId.trim(),
      });
    }
  }
}
