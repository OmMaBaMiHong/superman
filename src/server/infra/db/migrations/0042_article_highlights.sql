-- 0042_article_highlights.sql
CREATE TABLE article_highlights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  range_start_selector  TEXT NOT NULL,
  range_start_offset    INT NOT NULL,
  range_end_selector    TEXT NOT NULL,
  range_end_offset      INT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'yellow',
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, article_id, range_start_selector, range_start_offset)
);

CREATE INDEX idx_highlights_user_article ON article_highlights(user_id, article_id);
CREATE INDEX idx_highlights_created_at ON article_highlights(created_at DESC);
