-- 用户订阅偏好：各订阅来源下用户勾选的子类（热点平台 / GitHub 分类…）。
-- 空行 = 全订（未做选择时展示来源全量）；RSS 订阅天然按 feeds 表，不入本表。
CREATE TABLE IF NOT EXISTS user_source_prefs (
  user_id    TEXT NOT NULL,
  source_key TEXT NOT NULL,
  pref_key   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_key, pref_key)
);
