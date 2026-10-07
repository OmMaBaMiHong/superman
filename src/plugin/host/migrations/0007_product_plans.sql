-- ============================================================
-- 0007_product_plans.sql —— 产品计划（商业决策 MVP 规划）
-- 与主迁移体系 0063_product_plans.sql 同内容（create if not exists 幂等，
-- 两套迁移登记互不影响：主体系 schema_migrations / 插件 plugin_schema_migrations）。
--
-- 背景：用户除了「二创」之外，还需要一类「产品 / 商业变现」的产出：
--   1. 人工口述的想法（备忘录式）→ 直接落成产品计划；
--   2. AI 从采集/清洗/打标后的内容（尤其是「搞钱」方向）推理出的产品机会。
--   两个来源汇入同一张表，产出一份 MVP 规划：
--   产品描述 / 目标人群·客户 / 思路打法 / 商业模式 / 风险 /
--   竞品分析 / 定价 / 里程碑 / 验证计划。
--
-- 迁移安全性：全部 if not exists，幂等；回滚 drop table 即可。
-- ============================================================

create table if not exists product_plans (
  id                bigserial   primary key,
  user_id           bigint      not null references users(id) on delete cascade,
  title             text        not null default '',
  one_liner         text        not null default '',
  product_desc      text        not null default '',
  target_users      text        not null default '',
  approach          text        not null default '',
  business_model    text        not null default '',
  risks             text        not null default '',
  competitors       text        not null default '',
  pricing           text        not null default '',
  milestones        text        not null default '',
  validation_plan   text        not null default '',
  status            text        not null default 'idea',
  source_type       text        not null default 'manual',
  source_article_id bigint      references articles(id) on delete set null,
  source_url        text,
  source_note       text,
  ai_generated      bool        not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint product_plans_status_check
    check (status in ('idea', 'validating', 'building', 'launched', 'archived')),
  constraint product_plans_source_type_check
    check (source_type in ('manual', 'ai_inferred'))
);

create index if not exists idx_product_plans_user_updated
  on product_plans (user_id, updated_at desc);

create index if not exists idx_product_plans_user_status
  on product_plans (user_id, status);

create index if not exists idx_product_plans_source_article
  on product_plans (user_id, source_article_id)
  where source_article_id is not null;

-- notifications.kind 放宽：+ 'product_plan'（定时扫描发现产品机会进消息中心）
alter table notifications drop constraint if exists notifications_kind_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_kind_check'
  ) then
    alter table notifications
      add constraint notifications_kind_check
      check (kind in ('fetch_failed', 'pending_backlog', 'pipeline_done', 'redraft_done', 'system', 'performance_hot', 'comment_intel', 'product_plan'));
  end if;
end $$;
