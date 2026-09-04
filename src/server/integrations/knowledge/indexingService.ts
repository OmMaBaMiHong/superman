import { getPool } from '@/server/infra/db/pool';
import { chunkArticle } from './chunkingService';
import { generateEmbeddings } from './embeddingService';

/**
 * 索引单篇文章：删除旧索引 → 分块 → 生成 embedding → 批量插入。
 */
export async function indexArticle(
  articleId: number,
  title: string,
  content: string,
): Promise<void> {
  const pool = getPool();

  // 1. 删除旧索引
  await pool.query('delete from knowledge_embeddings where article_id = $1', [articleId]);

  // 2. 分块
  const chunks = chunkArticle(content, title);
  if (chunks.length === 0) return;

  // 3. 生成 embedding
  const texts = chunks.map((c) => c.text);
  const embeddings = await generateEmbeddings(texts);

  // 4. 批量插入
  const esc = (pool as unknown as { escapeLiteral(s: string): string }).escapeLiteral;
  const values = chunks
    .map((chunk, i) => {
      const embedding = embeddings[i];
      return `(${articleId}, ${chunk.index}, ${esc(chunk.text)}, ${esc(JSON.stringify(embedding))}::vector)`;
    })
    .join(', ');

  await pool.query(`
    insert into knowledge_embeddings (article_id, chunk_index, chunk_text, embedding)
    values ${values}
  `);
}

/**
 * 删除文章的索引数据。
 */
export async function deleteArticleIndex(articleId: number): Promise<void> {
  const pool = getPool();
  await pool.query('delete from knowledge_embeddings where article_id = $1', [articleId]);
}