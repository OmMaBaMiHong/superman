-- ============================================================
-- 0069_service_config.sql —— 服务运行配置（P2e-5 服务面板）
-- 键值表：调度器/keeper 等运行开关存 DB（设置页热切换，免重启）。
-- env（SUPERMAN_SCHEDULER_ENABLED 等）降级为首次部署兜底。
-- 插件侧同名迁移 0013_service_config.sql 同内容（幂等）。
-- ============================================================

create table if not exists service_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
