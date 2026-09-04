import { getPool } from '@/server/infra/db/pool';
import { generateEmbedding } from './embeddingService';

export interface SearchResult {
  articleId: number;
  chunkIndex: number;
  chunkText: string;
  title: string;
  score: number;
}

/**
 * 混合检索：向量检索 + 全文检索，通过 RRF（Reciprocal Rank Fusion）合并结果。
 */
export async function hybridSearch(
  question: string,
  limit: number = 10,
): Promise<SearchResult[]> {
  const pool = getPool();

  // 1. 生成问题 embedding
  const embedding = await generateEmbedding(question);
  const embeddingStr = JSON.stringify(embedding);

  // 2. 向量搜索（cosine 相似度）
  const vectorResults = await pool.query<{
    article_id: number;
    chunk_index: number;
    chunk_text: string;
    title: string;
    distance: number;
  }>(`
    select
      ke.article_id,
      ke.chunk_index,
      ke.chunk_text,
      a.title,
      1 - (ke.embedding <=> '${embeddingStr}'::vector) as distance
    from knowledge_embeddings ke
    join articles a on a.id = ke.article_id
    order by ke.embedding <=> '${embeddingStr}'::vector
    limit $1
  `, [limit * 2]);

  // 3. 全文搜索（tsvector）
  const ftsResults = await pool.query<{
    article_id: number;
    chunk_index: number;
    chunk_text: string;
    title: string;
    rank: number;
  }>(`
    select
      ke.article_id,
      ke.chunk_index,
      ke.chunk_text,
      a.title,
      ts_rank(to_tsvector('simple', ke.chunk_text), plainto_tsquery('simple', $1)) as rank
    from knowledge_embeddings ke
    join articles a on a.id = ke.article_id
    where to_tsvector('simple', ke.chunk_text) @@ plainto_tsquery('simple', $1)
    order by rank desc
    limit $2
  `, [question, limit * 2]);

  // 4. RRF 合并
  const scores = new Map<
    string,
    { result: SearchResult; vectorRank: number; ftsRank: number }
  >();

  vectorResults.rows.forEach((row, i) => {
    const key = `${row.article_id}-${row.chunk_index}`;
    scores.set(key, {
      result: {
        articleId: row.article_id,
        chunkIndex: row.chunk_index,
        chunkText: row.chunk_text,
        title: row.title,
        score: 0,
      },
      vectorRank: i + 1,
      ftsRank: Infinity,
    });
  });

  ftsResults.rows.forEach((row, i) => {
    const key = `${row.article_id}-${row.chunk_index}`;
    if (scores.has(key)) {
      scores.get(key)!.ftsRank = i + 1;
    } else {
      scores.set(key, {
        result: {
          articleId: row.article_id,
          chunkIndex: row.chunk_index,
          chunkText: row.chunk_text,
          title: row.title,
          score: 0,
        },
        vectorRank: Infinity,
        ftsRank: i + 1,
      });
    }
  });

  // RRF: score = 1 / (k + rank)
  const k = 60;
  const results = Array.from(scores.values()).map(({ result, vectorRank, ftsRank }) => ({
    ...result,
    score:
      (vectorRank !== Infinity ? 1 / (k + vectorRank) : 0) +
      (ftsRank !== Infinity ? 1 / (k + ftsRank) : 0),
  }));

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}