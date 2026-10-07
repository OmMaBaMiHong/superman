-- ============================================================
-- 0010_article_user_note.sql —— 收藏备注 / 想法（user_note）
-- 与主迁移 0066_article_user_note.sql 同内容（幂等）。
-- ============================================================

alter table articles
  add column if not exists user_note text not null default '';
