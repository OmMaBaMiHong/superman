import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { fail } from '@/server/infra/http/apiResponse';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { getDraftDetail } from '@/server/domains/pipelines/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: numericIdSchema });

function escapeFrontmatter(value: string): string {
  return value.replace(/"/g, '\\"');
}

/** 导出成稿为 markdown 下载（frontmatter 带 title/platform/原文链接/相似度）。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      throw new ValidationError('草稿 ID 非法', { id: '必须为正整数' });
    }
    const draft = await getDraftDetail(getPool(), parsed.data.id, session.userId);
    if (!draft) throw new NotFoundError('草稿不存在');

    const frontmatter = [
      '---',
      `title: "${escapeFrontmatter(draft.title)}"`,
      `platform: "${escapeFrontmatter(draft.platform)}"`,
      `original_title: "${escapeFrontmatter(draft.articleTitle)}"`,
      draft.articleLink ? `original_url: "${escapeFrontmatter(draft.articleLink)}"` : null,
      draft.similarityScore !== null ? `similarity_score: ${draft.similarityScore}` : null,
      `originality_flag: "${draft.originalityFlag}"`,
      `exported_at: "${new Date().toISOString()}"`,
      '---',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    const markdown = `${frontmatter}\n\n# ${draft.title}\n\n${draft.body}\n`;
    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="draft-${draft.id}.md"`,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
