-- ============================================================
-- 0061_article_favorite.sql —— 文章收藏标记
--
-- 背景：「我的 → 收藏」子标签需要快速查询用户标记为收藏的文章。
--   is_favorited：是否被用户收藏（收藏⭐按钮）
--   favorited_at：收藏时间（用于排序）
--
-- 迁移安全性：全部 if not exists，幂等；
--   回滚 drop 两列即可。
-- ============================================================

alter table articles
  add column if not exists is_favorited bool not null default false,
  add column if not exists favorited_at timestamptz;

create index if not exists idx_articles_user_favorited
  on articles (user_id, favorited_at desc nulls last)
  where is_favorited = true;
