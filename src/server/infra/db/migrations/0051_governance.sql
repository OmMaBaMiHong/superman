-- ============================================================
-- 0051_governance.sql —— 治理层（审批工作流）数据模型
--
-- 背景：移植「三省六部」的审批工作流（概念移植，非代码合并）。
--   新抓文章不再直接进阅读流，而是进入治理状态机：
--     candidate → pending → archived → used
--        ↘ rejected（驳回记忆 7 天内参与去重）
--
-- 变更内容：
--   1. articles 增加治理字段（状态 / 质量分 / 收录理由 / 重拟次数 / 治理更新时间）。
--   2. 新表 reject_logs：驳回记忆，7 天内参与 URL / 标题去重。
--   3. 新表 governance_preferences：按 user_id + category_id 维度的治理偏好
--      （每日上限 / 聚焦比 / 自动准奏阈值 / 排除关键词）。
--
-- 存量数据处理：
--   存量文章是用户已订阅资产，不应进入待批队列，
--   统一置为 'archived'（governance_status 新列默认 'candidate'，紧随 UPDATE 纠正）。
--
-- 迁移安全性：全部 add column if not exists / create table if not exists /
--   create index if not exists，幂等；回滚 drop 两张新表 + drop 五个新列即可。
-- ============================================================

alter table articles
  add column if not exists governance_status text not null default 'candidate',
  add column if not exists quality_score int,
  add column if not exists ai_reason text,
  add column if not exists redraft_count int not null default 0,
  add column if not exists governance_updated_at timestamptz;

-- 存量文章是已订阅资产，直接归档，不进待批队列。
update articles
set governance_status = 'archived',
    governance_updated_at = coalesce(governance_updated_at, now())
where governance_status = 'candidate';

-- 状态取值约束（幂等：已存在则跳过）。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'articles_governance_status_check'
  ) then
    alter table articles
      add constraint articles_governance_status_check
      check (governance_status in ('candidate', 'pending', 'archived', 'rejected', 'used'));
  end if;
end $$;

create index if not exists idx_articles_governance_status
  on articles (user_id, governance_status);

-- 驳回记忆：article 被清理（prune）后记忆仍保留，故 article_id 可空 + set null。
create table if not exists reject_logs (
  id          bigserial   primary key,
  user_id     bigint      not null references users(id) on delete cascade,
  article_id  bigint      references articles(id) on delete set null,
  reason      text        not null default '',
  title       text        not null default '',
  source_url  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_reject_logs_user_created
  on reject_logs (user_id, created_at);

-- 治理偏好：每用户每分类一行。
create table if not exists governance_preferences (
  id                     bigserial   primary key,
  user_id                bigint      not null references users(id) on delete cascade,
  category_id            bigint      not null references categories(id) on delete cascade,
  daily_limit            int         not null default 3,
  focus_ratio            int         not null default 60,
  auto_approve_threshold int         not null default 0,
  exclude_keywords       jsonb       not null default '[]'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint governance_preferences_daily_limit_check
    check (daily_limit between 1 and 100),
  constraint governance_preferences_focus_ratio_check
    check (focus_ratio between 0 and 100),
  constraint governance_preferences_auto_approve_threshold_check
    check (auto_approve_threshold between 0 and 100)
);

create unique index if not exists idx_governance_preferences_user_category
  on governance_preferences (user_id, category_id);
