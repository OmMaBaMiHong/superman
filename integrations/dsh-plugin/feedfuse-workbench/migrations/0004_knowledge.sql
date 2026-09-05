-- 0004_knowledge.sql —— pgvector 向量表 + 标签 + 看板（兼容原库）

-- ✅ knowledge_embeddings 表已存在（原库 0041），补列
ALTER TABLE knowledge_embeddings ADD COLUMN IF NOT EXISTS strategy_id UUID;
ALTER TABLE knowledge_embeddings ADD COLUMN IF NOT EXISTS chunk_type TEXT NOT NULL DEFAULT 'transcript';
-- 确保索引存在
CREATE INDEX IF NOT EXISTS knowledge_embeddings_article_idx ON knowledge_embeddings(article_id);
CREATE INDEX IF NOT EXISTS knowledge_embeddings_embedding_idx ON knowledge_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS knowledge_embeddings_chunk_text_gin ON knowledge_embeddings
  USING GIN (to_tsvector('simple', chunk_text));

-- ✅ tags 表已存在（原库 0043，含 user_id），无需重建
-- ✅ article_tags 表已存在（原库 0043），补 source 列
ALTER TABLE article_tags ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'strategy';
-- ✅ boards 表已存在（原库 0044，含 user_id），无需重建
-- ✅ board_items 表已存在（原库 0044），无需重建
