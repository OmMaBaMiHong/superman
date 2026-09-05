-- ============================================================
-- 0003_direction_strategies.sql —— 治理 v2 地基：方向策略模板化（P2b）
-- 与主迁移体系 0055_direction_strategies.sql 同内容（create if not exists 幂等，
-- 两套迁移登记互不影响：主体系 schema_migrations / 插件 plugin_schema_migrations）。
--
-- 背景：治理 v2 设计 §1。方向不再是写死的枚举——每个方向 = 一条
--   策略模板（关键词 DSL + AI 提示 + 配额权重 + UI 徽章属性），
--   新增方向零代码。内置四个：topic 选题 / money 搞钱 / learning 学习 /
--   general 其他（兜底）。
--
-- 新表：
--   direction_strategies：按 user_id 每用户一份（多用户隔离硬要求；
--   全局共享+个人覆盖太复杂，弃）。内置模板由 core/governance/directions.ts
--   在用户首次访问时 lazy seed（insert ... on conflict do nothing），
--   因此本迁移不落种子数据。
--
-- articles 加列：
--   direction_key / direction_reason。存量文章 direction_key 为 null 是预期
--   （历史资产不回刷），新抓文章由治理管线写入。
--   注意：direction_key 不加外键——模板按用户隔离（user_id, key 才唯一），
--   模板被删时历史文章的方向标记保留（仅存字符串语义）。
--
-- 迁移安全性：全部 if not exists，幂等；
--   回滚 drop direction_strategies + drop articles 两个新列即可。
-- ============================================================

create table if not exists direction_strategies (
  id           bigserial   primary key,
  user_id      bigint      not null references users(id) on delete cascade,
  key          text        not null,
  name         text        not null,
  color        text        not null default '#6b7280',
  icon         text        not null default '',
  keywords_dsl text        not null default '',
  ai_hint      text        not null default '',
  quota_weight int         not null default 0,
  enabled      bool        not null default true,
  sort         int         not null default 0,
  builtin      bool        not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint direction_strategies_key_format_check
    check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint direction_strategies_quota_weight_check
    check (quota_weight between 0 and 100)
);

create unique index if not exists idx_direction_strategies_user_key
  on direction_strategies (user_id, key);

create index if not exists idx_direction_strategies_user_enabled
  on direction_strategies (user_id, enabled, sort);

alter table articles
  add column if not exists direction_key text,
  add column if not exists direction_reason text;

create index if not exists idx_articles_direction_key
  on articles (user_id, direction_key);
