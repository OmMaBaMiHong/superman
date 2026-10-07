import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { extract } from '@extractus/article-extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const urlSchema = z.object({
  url: z.string().trim().url().max(2000),
}).strict();

/** POST /api/clipboard/url — 从 URL 抓取正文并收藏。 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;

  try {
    const body = await request.json().catch(() => null);
    const parsed = urlSchema.safeParse(body);
    if (!parsed.success) {
      return fail(new ValidationError('链接无效', { url: parsed.error.issues[0]?.message || '请输入合法 URL' }));
    }

    const article = await extract(parsed.data.url);
    if (!article?.content) {
      return fail(new ValidationError('抓取失败', { url: '无法提取页面内容，请尝试粘贴文本' }));
    }

    return ok({
      article: {
        title: article.title || '',
        content: article.content,
        url: parsed.data.url,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
