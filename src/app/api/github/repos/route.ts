import { z } from 'zod';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ConflictError, ValidationError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { listGithubSubscriptions } from '@/server/domains/github/repositories/githubSubscriptionsRepo';
import { createGithubSubscriptionService } from '@/server/domains/github/services/githubSubscriptionLifecycleService';
import { getGithubToken } from '@/server/domains/github/services/githubTokenService';
import { isGithubApiError } from '@/server/integrations/github/githubErrors';
import { mapGithubFetchError } from '@/server/domains/github/tasks/githubFetchErrorMapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const contentTypeSchema = z.enum(['release', 'issue', 'pr', 'commit']);

const createBodySchema = z
  .object({
    // 二选一：repoInput（自由输入）或 owner + repo
    repoInput: z.string().trim().min(1).optional(),
    owner: z.string().trim().min(1).max(100).optional(),
    repo: z.string().trim().min(1).max(100).optional(),

    title: z.string().trim().min(1).max(200).optional(),
    contentTypes: z.array(contentTypeSchema).min(1).default(['release']),
    includePrerelease: z.boolean().default(false),
    fetchIntervalMinutes: z.number().int().min(15).max(1440).default(60),
    categoryId: numericIdSchema.nullable().optional(),
    categoryName: z.string().trim().min(1).nullable().optional(),
  })
  .refine((value) => Boolean(value.repoInput) || (Boolean(value.owner) && Boolean(value.repo)), {
    path: ['repoInput'],
    message: '请填写仓库地址或 owner/repo',
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

/** 同一用户重复订阅同一仓库时命中唯一索引（0045 迁移的 user_id + owner + repo）。 */
function isDuplicateSubscription(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const subscriptions = await listGithubSubscriptions(getPool(), session.userId);
    return ok(subscriptions);
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
    const parsed = createBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(parsed.error)));
    }

    // MVP 只支持 release；字段已提前落地，P1 打开时无需改 schema。
    const unsupported = parsed.data.contentTypes.filter((type) => type !== 'release');
    if (unsupported.length > 0) {
      return fail(
        new ValidationError('Invalid request body', { contentTypes: 'unsupported_in_mvp' }),
      );
    }

    const repoInput = parsed.data.repoInput ?? `${parsed.data.owner}/${parsed.data.repo}`;
    const pool = getPool();
    // 私有仓库的存在性校验需要用户 Token；无 Token 时以匿名身份校验公开仓库。
    const token = await getGithubToken(pool, session.userId).catch(() => '');

    const subscription = await createGithubSubscriptionService(pool, {
      repoInput,
      title: parsed.data.title,
      contentTypes: parsed.data.contentTypes,
      includePrerelease: parsed.data.includePrerelease,
      categoryId: parsed.data.categoryId,
      categoryName: parsed.data.categoryName,
      fetchIntervalMinutes: parsed.data.fetchIntervalMinutes,
      token,
      userId: session.userId,
    });

    return ok(subscription);
  } catch (err) {
    if (isDuplicateSubscription(err)) {
      return fail(new ConflictError('该仓库已订阅', { repoInput: 'duplicate' }));
    }
    if (isGithubApiError(err)) {
      // 把 GitHub 语义错误翻译成 400，字段指向用户实际填写的输入框。
      const mapped = mapGithubFetchError(err);
      return fail(
        new ValidationError(mapped.errorMessage, {
          repoInput: err.kind === 'not_found' ? 'not_found' : mapped.errorCode,
        }),
      );
    }
    return fail(err);
  }
}
