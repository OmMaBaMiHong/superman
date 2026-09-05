-- K1 骨架心跳表：调度器每分钟写入一条，证明「DSH 插件进程 ↔ Postgres」链路可用。
-- K2 起领域迁移将统一接入 src/core 的迁移体系，本表仅属插件骨架。
CREATE TABLE IF NOT EXISTS plugin_heartbeats (
  id BIGSERIAL PRIMARY KEY,
  plugin TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
