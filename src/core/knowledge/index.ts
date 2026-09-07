/** core/knowledge 桶导出：分块 / 向量化 / 索引 / 混合检索（宿主无关）。 */
export { chunkArticle } from './chunking';
export {
  EMBEDDING_MODEL,
  generateEmbedding,
  generateEmbeddings,
  type EmbeddingDeps,
  type KnowledgeAiConfig,
} from './embedding';
export { indexArticle, deleteArticleIndex, type IndexArticleDeps } from './indexer';
export { hybridSearch, type HybridSearchDeps, type SearchResult } from './search';
