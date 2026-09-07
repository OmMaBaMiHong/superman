/**
 * 知识索引器（P2f-A 抽进 core）：删除旧索引 → 分块 → 向量化 → 批量插入。
 * db 由调用方注入（Pool / PoolClient 均可，宿主无关）。
 */
import type { Pool, PoolClient } from 'pg';
import { chunkArticle } from '@/core/knowledge/chunking';
import { generateEmbeddings, type KnowledgeAiConfig } from '@/core/knowledge/embedding';

type DbClient = Pool | PoolClient;

export interface IndexArticleDeps {
  /** 缺省用 embedding.ts 默认实现（OpenAI 兼容 + 注入 config）。 */
  embeddingFn?: (texts: string[]) => Promise<number[][]>;
  config?: KnowledgeAiConfig;
  createClient?: Parameters<typeof generateEmbeddings>[1]['createClient'];
}

/**
 * 索引单篇文章。分块为空时只清理旧索引。
 * 依赖项二选一：给 embeddingFn（测试/自定义），或给 config（+可选 createClient）。
 */
export async function indexArticle(
  db: DbClient,
  input: { articleId: number; title: string; content: string },
  deps: IndexArticleDeps,
): Promise<void> {
  // 1. 删除旧索引
  await db.query('delete from knowledge_embeddings where article_id = $1', [input.articleId]);

  // 2. 分块
  const chunks = chunkArticle(input.content, input.title);
  if (chunks.length === 0) return;

  // 3. 生成 embedding
  const texts = chunks.map((c) => c.text);
  const embeddings = deps.embeddingFn
    ? await deps.embeddingFn(texts)
    : await generateEmbeddings(texts, {
        config: deps.config as KnowledgeAiConfig,
        createClient: deps.createClient,
      });

  // 4. 批量插入（参数化，vector 字面量走 ::vector 转换）
  const values: unknown[] = [];
  const tuples = chunks.map((chunk, i) => {
    const b = i * 4;
    values.push(input.articleId, chunk.index, chunk.text, JSON.stringify(embeddings[i]));
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::vector)`;
  });

  await db.query(
    `
    insert into knowledge_embeddings (article_id, chunk_index, chunk_text, embedding)
    values ${tuples.join(', ')}
  `,
    values,
  );
}

/** 删除文章的索引数据。 */
export async function deleteArticleIndex(db: DbClient, articleId: number): Promise<void> {
  await db.query('delete from knowledge_embeddings where article_id = $1', [articleId]);
}
