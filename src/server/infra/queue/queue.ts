import { startBoss } from '@/server/infra/queue/boss';
import { getQueueDriver } from '@/server/infra/queue/localDriver';
import type { PgBoss } from 'pg-boss';

const ensuredQueues = new Set<string>();
const ensureQueuePromises = new Map<string, Promise<void>>();

async function ensureQueue(instance: PgBoss, name: string): Promise<void> {
  if (ensuredQueues.has(name)) return;

  let promise = ensureQueuePromises.get(name);
  if (!promise) {
    promise = instance
      .createQueue(name)
      .then(() => {
        ensuredQueues.add(name);
      })
      .catch((err) => {
        ensureQueuePromises.delete(name);
        throw err;
      });
    ensureQueuePromises.set(name, promise);
  }

  await promise;
}

export type EnqueueResult =
  | { status: 'enqueued'; jobId: string }
  | { status: 'throttled_or_duplicate' };

export async function enqueueWithResult(
  name: string,
  data: object | null,
  options?: unknown,
): Promise<EnqueueResult> {
  // 队列驱动可插拔（pglite 存储形态换本地驱动，见 localDriver.ts；缺省 pg-boss）
  const override = getQueueDriver();
  if (override) return override(name, data, options);
  const instance = await startBoss();
  await ensureQueue(instance, name);
  // pg-boss types differ between CJS/ESM builds; keep options loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobId = await instance.send(name, data, options as any);
  if (!jobId) return { status: 'throttled_or_duplicate' };
  return { status: 'enqueued', jobId: String(jobId) };
}

export async function enqueue(
  name: string,
  data: object | null,
  options?: unknown,
): Promise<string> {
  const result = await enqueueWithResult(name, data, options);
  if (result.status !== 'enqueued') throw new Error('Failed to enqueue job');
  return result.jobId;
}
