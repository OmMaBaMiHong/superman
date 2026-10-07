-- ============================================================
-- 0064_product_plans_pipeline.sql —— 产品计划：产品化方向 + 二创思路 + 流水线状态
--
-- 背景（用户拍板）：把「一条内容 → 一个产品思路」做成闭环流水线：
--   source（来源）→ transcript（文案）→ analysis（产品化分析）→ remix（二创思路）。
-- 从收藏/文章「转产品计划」时自动补齐缺失的上游步骤；详情页可手动重跑。
--
-- 新增列：
--   direction    产品化方向（这条内容最适合做成什么：短剧/漫剧/工具/服务…）
--   remix_ideas  二创思路（短剧/漫剧分镜、口播选题、图文 等具体改编方向）
--   pipeline     四步状态 JSONB：{ source, transcript, analysis, remix } 各 { status, at?, note? }
--
-- 迁移安全性：全部 if not exists，幂等；回滚 drop column 即可。
-- ============================================================

alter table product_plans
  add column if not exists direction   text  not null default '',
  add column if not exists remix_ideas text  not null default '',
  add column if not exists pipeline    jsonb not null default '{}'::jsonb;
