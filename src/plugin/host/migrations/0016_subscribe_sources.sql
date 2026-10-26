-- 订阅来源配置：订阅页一级导航数据驱动（新增来源插行即可，内容渲染按 key 渐进接入）。
CREATE TABLE IF NOT EXISTS subscribe_sources (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT 'rss',
  sort       INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO subscribe_sources (key, label, icon, sort) VALUES
  ('hot',    '热点新闻', 'flame',  10),
  ('rss',    'RSS 订阅', 'rss',    20),
  ('github', 'GitHub',   'github', 30),
  ('dsh',    'DSH 插件', 'puzzle', 40)
ON CONFLICT (key) DO NOTHING;
