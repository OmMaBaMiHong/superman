/**
 * 知识混合检索（P2f-A 抽进 core）：向量（cosine）+ 全文（tsvector simple）双路
 * 检索，RRF（Reciprocal Rank Fusion，k=60）合并。db 注入（宿主无关）。
 *
 * 降级：embedding 不可用（未配置 AI / 调用失败）时自动退为 FTS-only，不抛错。
 */
import type { Pool, PoolClient } from 'pg';
import { generateEmbedding, type EmbeddingDeps, type KnowledgeAiConfig } from '@/core/knowledge/embedding';

type DbClient = Pool | PoolClient;

export interface SearchResult {
  articleId: number;
  chunkIndex: number;
  chunkText: string;
  title: string;
  score: number;
}

export interface HybridSearchDeps {
  /** 缺省用 embedding.ts 默认实现；提供时测试可注入或强制降级（reject）。 */
  embeddingFn?: (question: string) => Promise<number[]>;
  config?: KnowledgeAiConfig;
  createClient?: EmbeddingDeps['createClient'];
}

const RRF_K = 60;

export async function hybridSearch(
  db: DbClient,
  question: string,
  limit: number = 10,
  deps?: HybridSearchDeps,
): Promise<SearchResult[]> {
  // 1. 问题向量化；失败/无配置 → 降级 FTS-only
  let embeddingStr: string | null = null;
  try {
    const embedding = deps?.embeddingFn
      ? await deps.embeddingFn(question)
      : await generateEmbedding(question, { config: deps!.config as KnowledgeAiConfig });
    embeddingStr = JSON.stringify(embedding);
  } catch {
    embeddingStr = null;
  }

  // 2. 向量路（降级时跳过）+ 全文路
  const limitDouble = limit * 2;
  const vectorRows = embeddingStr
    ? (await db.query<{
        article_id: number;
        chunk_index: number;
        chunk_text: string;
        title: string;
        distance: number;
      }>(
        `
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
      `,
        [limitDouble],
      )).rows
    : [];
  const ftsRows = (await db.query<{
    article_id: number;
    chunk_index: number;
    chunk_text: string;
    title: string;
    rank: number;
  }>(
    `
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
  `,
    [question, limitDouble],
  )).rows;

  // 3. RRF 合并（k=60）
  const scores = new Map<string, { result: SearchResult; vectorRank: number; ftsRank: number }>();

  vectorRows.forEach((row, i) => {
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
      ftsRank: 0,
    });
  });

  ftsRows.forEach((row, i) => {
    const key = `${row.article_id}-${row.chunk_index}`;
    const existing = scores.get(key);
    if (existing) {
      existing.ftsRank = i + 1;
    } else {
      scores.set(key, {
        result: {
          articleId: row.article_id,
          chunkIndex: row.chunk_index,
          chunkText: row.chunk_text,
          title: row.title,
          score: 0,
        },
        vectorRank: 0,
        ftsRank: i + 1,
      });
    }
  });

  const results = Array.from(scores.values()).map(({ result, vectorRank, ftsRank }) => ({
    ...result,
    score:
      (vectorRank > 0 ? 1 / (RRF_K + vectorRank) : 0) +
      (ftsRank > 0 ? 1 / (RRF_K + ftsRank) : 0),
  }));

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
