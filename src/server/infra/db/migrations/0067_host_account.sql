-- ============================================================
-- 0067_host_account.sql —— DSH 宿主身份直通（免登录）
-- users 表加 dsh_account_id：存 DSH 宿主侧稳定账号 ID（deepseekAccount profile.id）。
-- 绑定语义见 core/auth/usersRepo.ensureHostUser：宿主代管用户 password_hash='',
-- 不可口令登录，只能由宿主身份换会话。
-- 插件侧同名迁移 0011_host_account.sql 与本文件保持同内容（幂等）。
-- ============================================================

alter table users
  add column if not exists dsh_account_id text;

-- 部分唯一索引：一个 DeepSeek 账号至多绑定一个 Superman 用户；NULL 不受限。
create unique index if not exists users_dsh_account_id_unique
  on users (dsh_account_id)
  where dsh_account_id is not null;
