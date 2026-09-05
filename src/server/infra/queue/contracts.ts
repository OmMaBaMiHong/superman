export interface QueueCreateOptions {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  heartbeatSeconds?: number;
  expireInSeconds?: number;
  deadLetter?: string;
  warningQueueSize?: number;
}

export interface WorkerOptions {
  localConcurrency: number;
  batchSize: number;
  pollingIntervalSeconds?: number;
}

type SendContext = {
  userId?: string;
  articleId?: string;
  accountId?: string;
  feedId?: string;
  runId?: string;
  /** pipeline_jobs 业务任务 ID（pipeline.* 系列 job 的 singleton 粒度）。 */
  jobId?: string;
  force?: boolean;
};

interface QueueContract {
  queue: QueueCreateOptions;
  worker: WorkerOptions;
  send: (ctx: SendContext) => Record<string, unknown>;
}

export const QUEUE_CONTRACTS: Record<string, QueueContract> = {
  'feed.fetch': {
    queue: {
      retryLimit: 4,
      retryDelay: 20,
      retryBackoff: true,
      retryDelayMax: 600,
      deadLetter: 'dlq.feed.fetch',
      warningQueueSize: 200,
    },
    worker: { localConcurrency: 3, batchSize: 1 },
    send: (ctx) =>
      ctx.runId && ctx.feedId
        ? { singletonKey: [ctx.userId, ctx.runId, ctx.feedId].filter(Boolean).join(':'), singletonSeconds: 3600 }
        : {},
  },
  'article.fetch_fulltext': {
    queue: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 900,
      deadLetter: 'dlq.article.fulltext',
      heartbeatSeconds: 60,
      expireInSeconds: 1200,
      warningQueueSize: 300,
    },
    worker: { localConcurrency: 4, batchSize: 2 },
    send: (ctx) => ({ singletonKey: [ctx.userId, ctx.articleId].filter(Boolean).join(':'), singletonSeconds: 600 }),
  },
  'article.filter': {
    queue: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 900,
      deadLetter: 'dlq.article.filter',
      heartbeatSeconds: 60,
      expireInSeconds: 1200,
      warningQueueSize: 300,
    },
    worker: { localConcurrency: 3, batchSize: 1 },
    send: (ctx) => ({ singletonKey: [ctx.userId, ctx.articleId].filter(Boolean).join(':'), singletonSeconds: 600 }),
  },
  'ai.summarize_article': {
    queue: { heartbeatSeconds: 60, expireInSeconds: 1800, warningQueueSize: 300 },
    worker: { localConcurrency: 2, batchSize: 1 },
    send: (ctx) => ({ singletonKey: [ctx.userId, ctx.articleId].filter(Boolean).join(':'), singletonSeconds: 600, retryLimit: 0 }),
  },
  'ai.translate_article_zh': {
    queue: { heartbeatSeconds: 60, expireInSeconds: 1800, warningQueueSize: 300 },
    worker: { localConcurrency: 2, batchSize: 1 },
    send: (ctx) =>
      ctx.force
        ? { retryLimit: 0 }
        : { singletonKey: [ctx.userId, ctx.articleId].filter(Boolean).join(':'), singletonSeconds: 600, retryLimit: 0 },
  },
  'ai.translate_title_zh': {
    queue: { warningQueueSize: 300 },
    worker: { localConcurrency: 2, batchSize: 1 },
    send: (ctx) => ({ singletonKey: [ctx.userId, ctx.articleId].filter(Boolean).join(':'), singletonSeconds: 600, retryLimit: 0 }),
  },
  'ai.digest_tick': {
    queue: { warningQueueSize: 5 },
    worker: { localConcurrency: 1, batchSize: 1 },
    send: () => ({ singletonKey: 'ai.digest_tick', singletonSeconds: 55 }),
  },
  'ai.digest_generate': {
    queue: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 600,
      heartbeatSeconds: 60,
      expireInSeconds: 1800,
      warningQueueSize: 50,
    },
    worker: { localConcurrency: 1, batchSize: 1 },
    send: (ctx) =>
      ctx.runId ? { singletonKey: [ctx.userId, ctx.runId].filter(Boolean).join(':'), singletonSeconds: 3600 } : {},
  },
  'fever.sync': {
    queue: {
      retryLimit: 3,
      retryDelay: 30,
      heartbeatSeconds: 60,
      expireInSeconds: 3600,
      warningQueueSize: 50,
    },
    worker: { localConcurrency: 1, batchSize: 1 },
    // Fever 同步以账号为调度粒度，runId 只做追踪，不能破坏账号级互斥。
    send: (ctx) =>
      ctx.accountId
        ? { singletonKey: [ctx.userId, ctx.accountId].filter(Boolean).join(':'), singletonSeconds: 5 }
        : {},
  },
  'fever.sync_due': {
    queue: { warningQueueSize: 5 },
    worker: { localConcurrency: 1, batchSize: 1 },
    send: () => ({ singletonKey: 'fever.sync_due', singletonSeconds: 55 }),
  },
  'github.sync_due': {
    queue: { warningQueueSize: 5 },
    worker: { localConcurrency: 1, batchSize: 1 },
    send: () => ({ singletonKey: 'github.sync_due', singletonSeconds: 55 }),
  },
  'github.fetch_repo': {
    queue: {
      // 重试次数压到 2：GitHub 速率配额有限，重试放大会直接击穿配额。
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 1800,
      deadLetter: 'dlq.github.fetch',
      heartbeatSeconds: 60,
      expireInSeconds: 900,
      warningQueueSize: 200,
    },
    // 并发压到 2，保护速率配额（匿名 60 req/h、Token 5000 req/h）。
    worker: { localConcurrency: 2, batchSize: 1 },
    send: (ctx) => ({
      singletonKey: [ctx.userId, ctx.feedId].filter(Boolean).join(':'),
      singletonSeconds: 300,
    }),
  },
  'feed.refresh_all': {
    queue: { warningQueueSize: 50 },
    worker: { localConcurrency: 1, batchSize: 1 },
    send: (ctx) =>
      ctx.runId ? { singletonKey: [ctx.userId, ctx.runId].filter(Boolean).join(':'), singletonSeconds: 3600 } : {},
  },
  'system_logs.cleanup': {
    queue: { warningQueueSize: 5 },
    worker: { localConcurrency: 1, batchSize: 1 },
    send: () => ({ singletonKey: 'system_logs.cleanup', singletonSeconds: 3600 }),
  },
  'trendradar.sync': {
    queue: { retryLimit: 2, retryDelay: 60, warningQueueSize: 5 },
    worker: { localConcurrency: 1, batchSize: 1 },
    // 30 分钟一轮，singleton 覆盖整个周期，避免上一轮卡住时堆积。
    send: () => ({ singletonKey: 'trendradar.sync', singletonSeconds: 1740 }),
  },
  'pipeline.rewrite': {
    queue: {
      // 业务状态由 pipeline_jobs 自管（failed + 手动重试），关掉 pg-boss 自动重试。
      retryLimit: 0,
      heartbeatSeconds: 60,
      expireInSeconds: 1800,
      deadLetter: 'dlq.pipeline.rewrite',
      warningQueueSize: 100,
    },
    // 并发上限 2：LLM 调用别打爆。
    worker: { localConcurrency: 2, batchSize: 1 },
    send: (ctx) =>
      ctx.jobId ? { singletonKey: `pipeline.rewrite:${ctx.jobId}`, singletonSeconds: 1800 } : {},
  },
};

export function getQueueCreateOptions(name: string): QueueCreateOptions {
  return QUEUE_CONTRACTS[name]?.queue ?? {};
}

export function getWorkerOptions(name: string): WorkerOptions {
  return QUEUE_CONTRACTS[name]?.worker ?? { localConcurrency: 1, batchSize: 1 };
}

export function getQueueSendOptions(
  name: string,
  ctx: SendContext,
): Record<string, unknown> {
  return QUEUE_CONTRACTS[name]?.send(ctx) ?? {};
}
