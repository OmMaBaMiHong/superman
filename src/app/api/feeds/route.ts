import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { ConflictError, ValidationError } from '@/server/infra/http/errors';
import { listFeeds } from '@/server/domains/feeds/repositories/feedsRepo';
import { isSafeExternalUrl } from '@/server/integrations/rss/ssrfGuard';
import { createFeedWithCategoryResolution } from '@/server/domains/feeds/services/feedCategoryLifecycleService';
import { normalizeFeedAutoTriggerFlags } from '@/lib/feeds/feedAutoTriggerPolicy';
import { isRssHubUrl } from '@/lib/rsshub/url';
import {
  writeUserOperationFailedLog,
  writeUserOperationSucceededLog,
} from '@/server/infra/logging/userOperationLogger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const feedUrlSafetyOptions = { allowUnresolvedHostname: true } as const;

const categoryInputShape = {
  categoryId: numericIdSchema.nullable().optional(),
  categoryName: z.string().trim().min(1).nullable().optional(),
};
const feedContentViewSchema = z.enum(['article', 'picture', 'video', 'social', 'digest']);

const createFeedBodySchema = z
  .object({
    title: z.string().trim().min(1),
    url: z.string().trim().min(1).url(),
    siteUrl: z.string().trim().url().nullable().optional(),
    view: feedContentViewSchema.optional(),
    ...categoryInputShape,
    fullTextOnOpenEnabled: z.boolean().optional(),
    fullTextOnFetchEnabled: z.boolean().optional(),
    aiSummaryOnOpenEnabled: z.boolean().optional(),
    aiSummaryOnFetchEnabled: z.boolean().optional(),
    bodyTranslateOnFetchEnabled: z.boolean().optional(),
    bodyTranslateOnOpenEnabled: z.boolean().optional(),
    titleTranslateEnabled: z.boolean().optional(),
    bodyTranslateEnabled: z.boolean().optional(),
  })
  .refine((value) => !(value.categoryId && value.categoryName), {
    path: ['categoryName'],
    message: 'categoryId and categoryName are mutually exclusive',
  });

// 兼容 0034_multi_user 迁移前后的订阅 URL 唯一索引。
const feedUrlUniqueConstraints = new Set([
  'feeds_user_url_unique',
  'feeds_url_unique',
]);
const feedCategoryForeignKeyConstraints = new Set([
  'feeds_category_id_fkey',
  'feeds_category_user_scope_fkey',
]);

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

function isUniqueViolation(
  err: unknown,
  constraints: ReadonlySet<string>,
): err is { code: string; constraint?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505' &&
    (
      !('constraint' in err) ||
      (
        typeof (err as { constraint?: unknown }).constraint === 'string' &&
        constraints.has((err as { constraint: string }).constraint)
      )
    )
  );
}

function isForeignKeyViolation(
  err: unknown,
  constraints: ReadonlySet<string>,
): err is { code: string; constraint?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23503' &&
    (
      !('constraint' in err) ||
      (
        typeof (err as { constraint?: unknown }).constraint === 'string' &&
        constraints.has((err as { constraint: string }).constraint)
      )
    )
  );
}

const operationSource = 'app/api/feeds';

async function writeFeedCreateFailure(err: unknown, userId?: string) {
  await writeUserOperationFailedLog(getPool(), {
    userId,
    actionKey: 'feed.create',
    source: operationSource,
    err,
  });
}

export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const pool = getPool();
    const feeds = await listFeeds(pool, session.userId);

    const { rows } = await pool.query<{ feedId: string; unreadCount: number }>(`
      select feed_id as "feedId", count(*)::int as "unreadCount"
      from articles
      where is_read = false and filter_status = any('{passed,error}'::text[])
        and user_id = $1
      group by feed_id
    `, [session.userId]);

    const unreadByFeedId = new Map<string, number>();
    for (const row of rows) unreadByFeedId.set(row.feedId, row.unreadCount);

    const data = feeds.map((feed) => ({
      ...feed,
      unreadCount: unreadByFeedId.get(feed.id) ?? 0,
    }));

    return ok(data);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const json = await request.json().catch(() => null);
    const parsed = createFeedBodySchema.safeParse(json);
    if (!parsed.success) {
      const error = new ValidationError('Invalid request body', zodIssuesToFields(parsed.error));
      await writeFeedCreateFailure(error, session.userId);
      return fail(error);
    }
    if (
      !isRssHubUrl(parsed.data.url) &&
      !(await isSafeExternalUrl(parsed.data.url, feedUrlSafetyOptions))
    ) {
      const error = new ValidationError('Invalid request body', {
        url: '当前网络环境不允许访问该链接',
      });
      await writeFeedCreateFailure(error, session.userId);
      return fail(error);
    }

    const pool = getPool();
    const siteUrl = parsed.data.siteUrl ?? null;
    const created = await createFeedWithCategoryResolution(pool, normalizeFeedAutoTriggerFlags({
      ...parsed.data,
      userId: session.userId,
      siteUrl,
      fullTextOnOpenEnabled: parsed.data.fullTextOnOpenEnabled ?? false,
      fullTextOnFetchEnabled: parsed.data.fullTextOnFetchEnabled ?? false,
      aiSummaryOnOpenEnabled: parsed.data.aiSummaryOnOpenEnabled ?? false,
      aiSummaryOnFetchEnabled: parsed.data.aiSummaryOnFetchEnabled ?? false,
      bodyTranslateOnFetchEnabled: parsed.data.bodyTranslateOnFetchEnabled ?? false,
      bodyTranslateOnOpenEnabled: parsed.data.bodyTranslateOnOpenEnabled ?? false,
      titleTranslateEnabled: parsed.data.titleTranslateEnabled ?? false,
      bodyTranslateEnabled: parsed.data.bodyTranslateEnabled ?? false,
    }));
    await writeUserOperationSucceededLog(pool, {
      userId: session.userId,
      actionKey: 'feed.create',
      source: operationSource,
      context: { feedId: created.id },
    });

    return ok({ ...created, unreadCount: 0 });
  } catch (err) {
    if (isUniqueViolation(err, feedUrlUniqueConstraints)) {
      const error = new ConflictError('Feed already exists', { url: 'duplicate' });
      await writeFeedCreateFailure(error, session.userId);
      return fail(error);
    }
    if (isForeignKeyViolation(err, feedCategoryForeignKeyConstraints)) {
      const error = new ValidationError('Invalid request body', { categoryId: 'not_found' });
      await writeFeedCreateFailure(error, session.userId);
      return fail(error);
    }
    await writeFeedCreateFailure(err, session.userId);
    return fail(err);
  }
}
