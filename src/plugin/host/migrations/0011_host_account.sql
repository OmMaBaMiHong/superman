-- ============================================================
-- 0011_host_account.sql —— DSH 宿主身份直通（免登录）
-- 与主迁移 0067_host_account.sql 同内容（幂等）。
-- ============================================================

alter table users
  add column if not exists dsh_account_id text;

create unique index if not exists users_dsh_account_id_unique
  on users (dsh_account_id)
  where dsh_account_id is not null;
