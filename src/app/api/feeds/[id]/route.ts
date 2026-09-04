import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/server/infra/http/errors';
import { isSafeExternalUrl } from '@/server/integrations/rss/ssrfGuard';
import {
  deleteFeedAndCleanupCategory,
  updateFeedWithCategoryResolution,
} from '@/server/domains/feeds/services/feedCategoryLifecycleService';
import { getFeedById } from '@/server/domains/feeds/repositories/feedsRepo';
import { normalizeFeedAutoTriggerFlags } from '@/lib/feeds/feedAutoTriggerPolicy';
import { isRssHubUrl } from '@/lib/rsshub/url';
import {
  writeUserOperationFailedLog,
  writeUserOperationSucceededLog,
} from '@/server/infra/logging/userOperationLogger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const feedUrlSafetyOptions = { allowUnresolvedHostname: true } as const;

const paramsSchema = z.object({
  id: numericIdSchema,
});

const categoryInputShape = {
  categoryId: numericIdSchema.nullable().optional(),
  categoryName: z.string().trim().min(1).nullable().optional(),
};
const feedContentViewSchema = z.enum(['article', 'picture', 'video', 'social', 'digest']);

const patchBodySchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).url().optional(),
    siteUrl: z.string().trim().url().nullable().optional(),
    view: feedContentViewSchema.optional(),
    enabled: z.boolean().optional(),
    ...categoryInputShape,
    fullTextOnOpenEnabled: z.boolean().optional(),
    fullTextOnFetchEnabled: z.boolean().optional(),
    aiSummaryOnOpenEnabled: z.boolean().optional(),
    aiSummaryOnFetchEnabled: z.boolean().optional(),
    bodyTranslateOnFetchEnabled: z.boolean().optional(),
    bodyTranslateOnOpenEnabled: z.boolean().optional(),
    titleTranslateEnabled: z.boolean().optional(),
    bodyTranslateEnabled: z.boolean().optional(),
    articleListDisplayMode: z.enum(['card', 'list']).optional(),
  })
  .refine((value) => !(value.categoryId && value.categoryName), {
    path: ['categoryName'],
    message: 'categoryId and categoryName are mutually exclusive',
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
    path: ['body'],
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

const patchOperationSource = 'app/api/feeds/[id]';
const deleteOperationSource = 'app/api/feeds/[id]';

function validateFeverManagedFeedMutation(
  existingFeed: Awaited<ReturnType<typeof getFeedById>>,
  input: Record<string, unknown>,
) {
  if (!existingFeed || existingFeed.provider !== 'fever') {
    return null;
  }

  const forbiddenFields = ['title', 'url', 'siteUrl', 'categoryId', 'categoryName'];
  const touchedForbiddenFields = forbiddenFields.filter((field) => typeof input[field] !== 'undefined');
  if (touchedForbiddenFields.length === 0) {
    return null;
  }

  const fields: Record<string, string> = {};
  touchedForbiddenFields.forEach((field) => {
    fields[field] = 'Fever 托管源不支持修改该字段';
  });
  return new ValidationError('Invalid request body', fields);
}

function resolveFeedPatchActionKey(input: Record<string, unknown>) {
  const keys = Object.keys(input);
  if (keys.length === 1 && keys[0] === 'enabled' && typeof input.enabled === 'boolean') {
    return input.enabled ? 'feed.enable' : 'feed.disable';
  }
  if (
    keys.length > 0 &&
    keys.every((key) => key === 'categoryId' || key === 'categoryName')
  ) {
    return 'feed.moveToCategory';
  }
  if (keys.length === 1 && keys[0] === 'articleListDisplayMode') {
    return 'feed.articleListDisplayMode.update';
  }
  return 'feed.update';
}

async function writeFeedPatchFailure(
  actionKey: ReturnType<typeof resolveFeedPatchActionKey>,
  err: unknown,
  userId?: string,
  context?: Record<string, unknown>,
) {
  await writeUserOperationFailedLog(getPool(), {
    userId,
    actionKey,
    source: patchOperationSource,
    err,
    context,
  });
}

async function writeFeedDeleteFailure(
  err: unknown,
  userId?: string,
  context?: Record<string, unknown>,
) {
  await writeUserOperationFailedLog(getPool(), {
    userId,
    actionKey: 'feed.delete',
    source: deleteOperationSource,
    err,
    context,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  let actionKey: ReturnType<typeof resolveFeedPatchActionKey> = 'feed.update';

  try {
    const params = await context.params;
    const paramsParsed = paramsSchema.safeParse(params);
    if (!paramsParsed.success) {
      const error = new ValidationError('Invalid route params', zodIssuesToFields(paramsParsed.error));
      await writeFeedPatchFailure(actionKey, error, session.userId);
      return fail(error);
    }

    const json = await request.json().catch(() => null);
    const bodyParsed = patchBodySchema.safeParse(json);
    if (!bodyParsed.success) {
      const error = new ValidationError('Invalid request body', zodIssuesToFields(bodyParsed.error));
      await writeFeedPatchFailure(actionKey, error, session.userId, { feedId: paramsParsed.data.id });
      return fail(error);
    }
    actionKey = resolveFeedPatchActionKey(bodyParsed.data);
    if (
      typeof bodyParsed.data.url !== 'undefined' &&
      !isRssHubUrl(bodyParsed.data.url) &&
      !(await isSafeExternalUrl(bodyParsed.data.url, feedUrlSafetyOptions))
    ) {
      const error = new ValidationError('Invalid request body', {
        url: '当前网络环境不允许访问该链接',
      });
      await writeFeedPatchFailure(actionKey, error, session.userId, { feedId: paramsParsed.data.id });
      return fail(error);
    }

    const input = normalizeFeedAutoTriggerFlags({
      ...bodyParsed.data,
    });

    const pool = getPool();
    const existingFeed = await getFeedById(pool, paramsParsed.data.id, session.userId);
    const managedFeedMutationError = validateFeverManagedFeedMutation(existingFeed, input);
    if (managedFeedMutationError) {
      await writeFeedPatchFailure(actionKey, managedFeedMutationError, session.userId, {
        feedId: paramsParsed.data.id,
      });
      return fail(managedFeedMutationError);
    }
    const updated = await updateFeedWithCategoryResolution(pool, paramsParsed.data.id, {
      ...input,
      userId: session.userId,
    });
    if (!updated) {
      const error = new NotFoundError('Feed not found');
      await writeFeedPatchFailure(actionKey, error, session.userId, { feedId: paramsParsed.data.id });
      return fail(error);
    }
    await writeUserOperationSucceededLog(pool, {
      userId: session.userId,
      actionKey,
      source: patchOperationSource,
      context: { feedId: updated.id },
    });
    return ok(updated);
  } catch (err) {
    if (isUniqueViolation(err, feedUrlUniqueConstraints)) {
      const error = new ConflictError('Feed already exists', { url: 'duplicate' });
      await writeFeedPatchFailure(actionKey, error, session.userId);
      return fail(error);
    }
    if (isForeignKeyViolation(err, feedCategoryForeignKeyConstraints)) {
      const error = new ValidationError('Invalid request body', { categoryId: 'not_found' });
      await writeFeedPatchFailure(actionKey, error, session.userId);
      return fail(error);
    }
    await writeFeedPatchFailure(actionKey, err, session.userId);
    return fail(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const params = await context.params;
    const paramsParsed = paramsSchema.safeParse(params);
    if (!paramsParsed.success) {
      const error = new ValidationError('Invalid route params', zodIssuesToFields(paramsParsed.error));
      await writeFeedDeleteFailure(error, session.userId);
      return fail(error);
    }

    const pool = getPool();
    const existingFeed = await getFeedById(pool, paramsParsed.data.id, session.userId);
    if (existingFeed?.provider === 'fever') {
      const error = new ValidationError('Invalid request body', { id: 'Fever 托管源不支持从此入口删除' });
      await writeFeedDeleteFailure(error, session.userId, { feedId: paramsParsed.data.id });
      return fail(error);
    }
    const deleted = await deleteFeedAndCleanupCategory(pool, paramsParsed.data.id, session.userId);
    if (!deleted) {
      const error = new NotFoundError('Feed not found');
      await writeFeedDeleteFailure(error, session.userId, { feedId: paramsParsed.data.id });
      return fail(error);
    }
    await writeUserOperationSucceededLog(pool, {
      userId: session.userId,
      actionKey: 'feed.delete',
      source: deleteOperationSource,
      context: { feedId: paramsParsed.data.id },
    });

    return ok({ deleted: true });
  } catch (err) {
    await writeFeedDeleteFailure(err, session.userId);
    return fail(err);
  }
}
