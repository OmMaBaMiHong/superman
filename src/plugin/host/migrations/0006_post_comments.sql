-- ============================================================
-- 0006_post_comments.sql —— 评论反哺选题（P3a）
-- 与主迁移体系 0058_post_comments.sql 同内容（create if not exists 幂等，
-- 两套迁移登记互不影响：主体系 schema_migrations / 插件 plugin_schema_migrations）。
--
-- 背景：治理 v2 设计 §2「评论抓取（二期）：作品评论 → 关键词/情感粗分析
--   → 反哺选题池」。评论来自独立爬虫服务（integrations/crawler-service），
--   经 core/crawlerClient 拉取、落本表，再粗分析晋升治理 candidate。
--
-- 新表：
--   post_comments：作品评论快照（(post_id, comment_id) 唯一；likes 可刷新，
--     内容保留首见——评论内容以首见为准，避免编辑导致语料漂移）。
-- 列变更：
--   published_posts.comments_synced_at：评论同步游标（24h 一轮）。
--   published_posts.comment_intel_at：上次粗分析时间（观察用，不参与调度）。
-- 约束变更：
--   feeds.kind 放宽：+ 'comment_intel'（评论选题合成 feed，同 trend_radar 模式）。
--   notifications.kind 放宽：+ 'comment_intel'（新候选进消息中心）。
--
-- 迁移安全性：全部 if not exists / drop constraint if exists + 条件重加，幂等；
--   回滚 drop post_comments + 移除两列 + 恢复两个 kind 约束即可。
-- ============================================================

create table if not exists post_comments (
  id           bigserial   primary key,
  post_id      bigint      not null references published_posts(id) on delete cascade,
  comment_id   text        not null,
  author       text        not null default '',
  content      text        not null default '',
  likes        bigint,
  reply_count  int,
  ip_location  text,
  commented_at timestamptz,
  raw_json     jsonb,
  fetched_at   timestamptz not null default now(),
  constraint post_comments_post_comment_unique unique (post_id, comment_id)
);

create index if not exists idx_post_comments_post_likes
  on post_comments (post_id, likes desc nulls last);

alter table published_posts add column if not exists comments_synced_at timestamptz;
alter table published_posts add column if not exists comment_intel_at timestamptz;

-- feeds.kind 放宽：+ 'comment_intel'（幂等：先 drop if exists，不存在才 add）
alter table feeds drop constraint if exists feeds_kind_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'feeds_kind_check'
  ) then
    alter table feeds
      add constraint feeds_kind_check
      check (kind in ('rss', 'ai_digest', 'github', 'trend_radar', 'comment_intel'));
  end if;
end $$;

-- notifications.kind 放宽：+ 'comment_intel'
alter table notifications drop constraint if exists notifications_kind_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_kind_check'
  ) then
    alter table notifications
      add constraint notifications_kind_check
      check (kind in ('fetch_failed', 'pending_backlog', 'pipeline_done', 'redraft_done', 'system', 'performance_hot', 'comment_intel'));
  end if;
end $$;
