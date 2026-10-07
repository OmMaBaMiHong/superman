-- ============================================================
-- 0013_service_config.sql —— 服务运行配置（P2e-5 服务面板）
-- 与主迁移 0069_service_config.sql 同内容（幂等）。
-- ============================================================

create table if not exists service_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
