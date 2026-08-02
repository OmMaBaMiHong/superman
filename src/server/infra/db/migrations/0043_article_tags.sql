-- 0043_article_tags.sql
CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT 'gray',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE TABLE article_tags (
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(article_id, tag_id)
);

CREATE INDEX idx_article_tags_tag ON article_tags(tag_id);
CREATE INDEX idx_tags_user ON tags(user_id);

ALTER TABLE articles ADD COLUMN ai_suggested_tags JSONB DEFAULT NULL;
