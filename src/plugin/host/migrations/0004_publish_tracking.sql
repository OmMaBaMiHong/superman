-- ============================================================
-- 0004_publish_tracking.sql —— 发布后表现追踪（P2d）
-- 与主迁移体系 0056_publish_tracking.sql 同内容（create if not exists 幂等，
-- 两套迁移登记互不影响：主体系 schema_migrations / 插件 plugin_schema_migrations）。
--
-- 背景：治理 v2 设计 §2「补上发布后这半条命」：
--   选题 → 二创 → 发布（手动登记链接先行）→ 表现快照追踪 → 火了反哺选题。
--
-- 新表：
--   1. published_posts：发布登记（一帖一行，(user_id, post_url) 唯一）。
--      附带追踪状态字段：last_fetched_at（到期窗口计算）、
--      fetch_fail_count/last_error（连续失败容错）、
--      last_hot_notified_at（火了提示 24h 防重）。
--   2. post_metrics_snapshots：表现快照，只追加不改历史（时间序列资产）。
--
-- 约束变更：
--   notifications.kind check 放宽，新增 'performance_hot'（火了提示）。
--
-- 迁移安全性：全部 if not exists / drop constraint if exists + 条件重加，
--   幂等；回滚 drop 两张新表 + 恢复 kind 约束即可。
-- ============================================================

create table if not exists published_posts (
  id                   bigserial   primary key,
  user_id              bigint      not null references users(id) on delete cascade,
  draft_id             bigint      references drafts(id) on delete set null,
  article_id           bigint      references articles(id) on delete set null,
  platform             text        not null,
  account_name         text        not null default '',
  post_url             text        not null,
  title                text        not null default '',
  published_at         timestamptz,
  tracking_enabled     bool        not null default true,
  last_fetched_at      timestamptz,
  fetch_fail_count     int         not null default 0,
  last_error           text,
  last_hot_notified_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint published_posts_platform_check
    check (platform in ('bilibili', 'douyin', 'xhs', 'wechat', 'other'))
);

create unique index if not exists idx_published_posts_user_url
  on published_posts (user_id, post_url);

create index if not exists idx_published_posts_user_tracking
  on published_posts (user_id, tracking_enabled, published_at);

create table if not exists post_metrics_snapshots (
  id              bigserial   primary key,
  post_id         bigint      not null references published_posts(id) on delete cascade,
  fetched_at      timestamptz not null default now(),
  views           bigint,
  likes           bigint,
  comments        bigint,
  shares          bigint,
  favorites       bigint,
  coins           bigint,
  followers_delta bigint,
  raw_json        jsonb
);

-- 快照只追加：按 post 取时间序列 / 最新一条高频
create index if not exists idx_post_metrics_snapshots_post_fetched
  on post_metrics_snapshots (post_id, fetched_at desc);

-- notifications.kind 放宽：加 'performance_hot'（幂等：先 drop if exists，不存在才 add）
alter table notifications drop constraint if exists notifications_kind_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_kind_check'
  ) then
    alter table notifications
      add constraint notifications_kind_check
      check (kind in ('fetch_failed', 'pending_backlog', 'pipeline_done', 'redraft_done', 'system', 'performance_hot'));
  end if;
end $$;
