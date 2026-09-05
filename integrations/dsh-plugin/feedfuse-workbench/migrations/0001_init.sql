-- 0001_init.sql —— 兼容原 FeedFuse 库：已有表补列，新表创建

-- ✅ categories 表已存在（含 user_id），无需修改

-- ✅ feeds 表：补 platform 列（原库已有 user_id / etag / last_modified 等）
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS platform TEXT;

-- ✅ articles 表：补充插件所需列（原库已有 user_id / read_at / is_starred / ai_summary 等）
ALTER TABLE articles ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'article';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS duration_sec INT DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS stats JSONB;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS transcript_source TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS transcript_extracted_at TIMESTAMPTZ;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE articles ADD COLUMN IF NOT EXISTS score INT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS priority INT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS sentiment TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS analysis_count INT DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 为 articles 新列建索引
CREATE INDEX IF NOT EXISTS articles_media_type_idx ON articles(media_type);
CREATE INDEX IF NOT EXISTS articles_category_idx ON articles(category);
CREATE INDEX IF NOT EXISTS articles_score_idx ON articles(score DESC NULLS LAST);
