import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { extractTranscript } from '@/server/services/video/transcript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// articleId 在应用内为 string（Article.id），但部分调用方可能传 number，统一做兼容转换
const articleIdSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/).transform((v) => Number(v))])
  .nullable()
  .optional();

const bodySchema = z.object({
  url: z.string().url(),
  articleId: articleIdSchema,
  videoTitle: z.string().optional(),
  provider: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = session.userId ? Number(session.userId) : undefined;

  try {
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      console.error('[video/transcript] validation failed', JSON.stringify(parsed.error.flatten()), 'body:', JSON.stringify(json));
      return fail(new ValidationError('无效的请求参数', { url: '必须提供有效的视频 URL' }));
    }

    const { url, articleId, videoTitle, provider } = parsed.data;
    const result = await extractTranscript(url, articleId ?? undefined, userId, videoTitle, provider);

    return ok({
      text: result.text,
      source: result.source,
      language: result.language,
    });
  } catch (err) {
    return fail(err);
  }
}