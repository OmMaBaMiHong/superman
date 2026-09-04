import { z } from 'zod';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import {
  deleteGithubSubscriptionService,
  updateGithubSubscriptionService,
} from '@/server/domains/github/services/githubSubscriptionLifecycleService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const contentTypeSchema = z.enum(['release', 'issue', 'pr', 'commit']);

const patchBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    fetchIntervalMinutes: z.number().int().min(15).max(1440).optional(),
    includePrerelease: z.boolean().optional(),
    contentTypes: z.array(contentTypeSchema).min(1).optional(),
    categoryId: numericIdSchema.nullable().optional(),
    categoryName: z.string().trim().min(1).nullable().optional(),
  })
  .refine((value) => !(value.categoryId && value.categoryName), {
    path: ['categoryName'],
    message: 'categoryId and categoryName are mutually exclusive',
  });

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { id } = await context.params;
    if (!id?.trim()) {
      return fail(new ValidationError('Invalid request', { id: '缺少订阅 id' }));
    }

    const json = await request.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(parsed.error)));
    }

    // MVP 只支持 release；与 POST 保持一致的闸门。
    if (parsed.data.contentTypes?.some((type) => type !== 'release')) {
      return fail(
        new ValidationError('Invalid request body', { contentTypes: 'unsupported_in_mvp' }),
      );
    }

    const updated = await updateGithubSubscriptionService(getPool(), {
      feedId: id,
      ...parsed.data,
      userId: session.userId,
    });
    if (!updated) {
      return fail(new NotFoundError('GitHub 订阅不存在'));
    }

    return ok(updated);
  } catch (err) {
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
    const { id } = await context.params;
    if (!id?.trim()) {
      return fail(new ValidationError('Invalid request', { id: '缺少订阅 id' }));
    }

    const deleted = await deleteGithubSubscriptionService(getPool(), id, session.userId);
    if (!deleted) {
      return fail(new NotFoundError('GitHub 订阅不存在'));
    }

    // 级联：feeds 删除后 articles / github_repo_subscriptions / github_article_items 全部 on delete cascade。
    return ok({ id });
  } catch (err) {
    return fail(err);
  }
}
