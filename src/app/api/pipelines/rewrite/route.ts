import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { isRewritePlatform } from '@/server/domains/pipelines/rewriteProfiles';
import { createRewriteJobs } from '@/server/domains/pipelines/services/pipelineService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  articleId: numericIdSchema,
  platforms: z
    .array(z.string())
    .min(1, 'platforms 至少一个')
    .refine((list) => list.every(isRewritePlatform), {
      message: 'platforms 仅支持 wechat/xhs/novel',
    }),
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('请求参数非法', zodIssuesToFields(parsed.error));
    }

    const results = await createRewriteJobs(getPool(), {
      articleId: parsed.data.articleId,
      platforms: parsed.data.platforms,
      userId: session.userId,
    });
    return ok({
      jobs: results.map(({ job, reused, enqueued, queueJobId }) => ({
        id: job.id,
        articleId: job.articleId,
        kind: job.kind,
        platform: job.platform,
        status: job.status,
        reused,
        enqueued,
        queueJobId,
        createdAt: job.createdAt,
      })),
    });
  } catch (err) {
    return fail(err);
  }
}
