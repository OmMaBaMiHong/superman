/**
 * 存量文章向量回填（P2f-A4）：找出没有任何 embedding 分块的文章，
 * 逐篇补索引（indexOne 注入；缺省走 core indexer + 注入 config）。
 * 无 AI 配置时由调用方（调度 tick）跳过，本模块不解析 settings。
 */
import type { Pool, PoolClient } from 'pg';
import { indexArticle, type IndexArticleDeps } from '@/core/knowledge/indexer';

type DbClient = Pool | PoolClient;

export interface BackfillResult {
  scanned: number;
  indexed: number;
  failed: number;
  /** 回填后仍无向量的文章数；无法估算时为 null。 */
  remaining: number | null;
}

export interface BackfillDeps extends IndexArticleDeps {
  /** 单篇索引函数（测试注入）；缺省 indexArticle（需要 deps.config）。 */
  indexOne?: (db: DbClient, input: { articleId: number; title: string; content: string }) => Promise<unknown>;
}

export async function backfillKnowledge(
  db: DbClient,
  input: { limit?: number } & BackfillDeps,
): Promise<BackfillResult> {
  const limit = Math.max(1, Math.min(200, Math.round(input.limit ?? 20)));
  const { rows } = await db.query<{ id: string; title: string; body: string }>(
    `
      select a.id::text as id,
             a.title,
             coalesce(a.content_full_html, a.content_html, a.summary, '') as body
      from articles a
      left join knowledge_embeddings ke on ke.article_id = a.id
      where ke.id is null
      order by a.id
      limit $1
    `,
    [limit],
  );
  if (rows.length === 0) {
    return { scanned: 0, indexed: 0, failed: 0, remaining: null };
  }

  const result: BackfillResult = { scanned: rows.length, indexed: 0, failed: 0, remaining: null };
  const indexOne = input.indexOne
    ?? ((client: DbClient, article: { articleId: number; title: string; content: string }) =>
      indexArticle(client, article, { config: input.config, createClient: input.createClient }));

  for (const row of rows) {
    try {
      await indexOne(db, {
        articleId: Number(row.id),
        title: row.title,
        content: row.body,
      });
      result.indexed += 1;
    } catch {
      result.failed += 1;
    }
  }

  const remainingRows = await db.query<{ remaining: string }>(
    `
      select count(*)::text as remaining
      from articles a
      left join knowledge_embeddings ke on ke.article_id = a.id
      where ke.id is null
    `,
  );
  result.remaining = Number(remainingRows.rows[0]?.remaining ?? 0);
  return result;
}
