-- ============================================================
-- 0008_product_plans_pipeline.sql —— 产品计划：产品化方向 + 二创思路 + 流水线状态
-- 与主迁移体系 0064_product_plans_pipeline.sql 同内容（幂等，两套迁移登记互不影响）。
-- ============================================================

alter table product_plans
  add column if not exists direction   text  not null default '',
  add column if not exists remix_ideas text  not null default '',
  add column if not exists pipeline    jsonb not null default '{}'::jsonb;
