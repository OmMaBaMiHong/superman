import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { createClip } from '@/core/clips/service';
import { listClips } from '@/core/clips/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createClipBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  contentText: z.string().trim().min(1).max(50000),
  contentHtml: z.string().max(100000).optional(),
  sourceUrl: z.string().trim().url().max(2000).nullable().optional(),
  sourceTitle: z.string().trim().max(500).nullable().optional(),
  imageUrls: z.array(z.string().url().max(2000)).max(20).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/**
 * POST /api/clips —— 剪贴板快速收藏。
 * 用户从任意地方复制内容粘贴进来，跳过审批直接入库。
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = createClipBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('参数校验失败', zodIssuesToFields(parsed.error));
    }

    const result = await createClip(getPool(), {
      userId: session.userId,
      title: parsed.data.title,
      contentText: parsed.data.contentText,
      contentHtml: parsed.data.contentHtml,
      sourceUrl: parsed.data.sourceUrl,
      sourceTitle: parsed.data.sourceTitle,
      imageUrls: parsed.data.imageUrls,
      note: parsed.data.note,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/**
 * GET /api/clips —— 列出当前用户的收藏。
 */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
    const offset = Number(url.searchParams.get('offset')) || 0;
    const result = await listClips(getPool(), session.userId, { limit, offset });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
