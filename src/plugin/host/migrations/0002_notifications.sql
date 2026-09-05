-- ============================================================
-- 0002_notifications.sql —— 消息中心（P2a）
-- 与主迁移体系 0054_notifications.sql 同内容（create if not exists 幂等，
-- 两套迁移登记互不影响：主体系 schema_migrations / 插件 plugin_schema_migrations）。
--
-- 背景：治理 v2 设计 §3。系统事件（采集失败 / 待批积压 / 流水线完成 /
--   重拟完成 / 系统通知）落表，H5 消息页按天分组展示，底部 tab 未读徽章。
--   Web Push（PWA）预留，本批次不落。
--
-- 新表：
--   notifications：一条事件一条消息。kind check 约束限定五类。
--
-- 迁移安全性：全部语句带 if not exists，幂等；
--   回滚 drop notifications 即可，不触碰任何存量表。
-- ============================================================

create table if not exists notifications (
  id         bigserial   primary key,
  user_id    bigint      not null references users(id) on delete cascade,
  kind       text        not null,
  title      text        not null,
  body       text        not null default '',
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_kind_check
    check (kind in ('fetch_failed', 'pending_backlog', 'pipeline_done', 'redraft_done', 'system'))
);

-- 未读筛选（未读列表/徽章计数高频）
create index if not exists idx_notifications_user_read
  on notifications (user_id, read_at);

-- 按天分组列表（created_at desc 翻页高频）
create index if not exists idx_notifications_user_created
  on notifications (user_id, created_at desc);
