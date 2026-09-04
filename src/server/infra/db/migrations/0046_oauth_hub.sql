-- ============================================================
-- 0046_oauth_hub.sql —— 三方授权中心（T01 基础设施与数据契约）
--
-- 设计原则（见 docs/arch-oauth-hub.md ADR-01 / ADR-02 / ADR-08）：
--   1. 平台应用配置按「行」建模而非往 app_settings 加列，新增平台零 DDL。
--   2. 一切凭据类字段落库前必须经 secretBox 加密（列名统一 *_encrypted 后缀）。
--   3. 授权临时态独立成表，一次性消费 + TTL，不污染 session。
--
-- 迁移安全性：
--   全部为 create table if not exists / create index if not exists，
--   不触碰任何存量表与约束，对现有 GitHub PAT 链路零影响，
--   可安全回滚（drop 三张新表即可）。
-- ============================================================

-- ------------------------------------------------------------
-- (1) 平台应用配置（全局单例，与用户无关）
--     provider 作主键：新增平台只插一行，无需 DDL。
--     client_id 明文（公开值，会出现在授权 URL 中）；
--     client_secret 必须加密，明文永不落库。
-- ------------------------------------------------------------
create table if not exists oauth_provider_configs (
  provider                  text primary key,
  client_id                 text        not null default '',
  client_secret_encrypted   text        not null default '',
  enabled                   boolean     not null default true,
  -- 平台差异化配置预留（如自定义 scope、企业号 agentId），MVP 恒为 {}。
  extra_config              jsonb       not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint oauth_provider_configs_provider_check
    check (provider in ('github', 'wechat', 'douyin', 'xiaohongshu'))
);

-- ------------------------------------------------------------
-- (2) 用户级授权连接
--     唯一键提前落地为 (user_id, provider, provider_account_id)：
--     MVP 由服务层约束「每平台单连接」，R13 多账号放开服务层即可零迁移（ADR-08）。
--     status 四态提前进 CHECK，同样为零迁移扩展。
-- ------------------------------------------------------------
create table if not exists oauth_connections (
  id                        bigserial   primary key,
  user_id                   bigint      not null references users(id) on delete cascade,
  provider                  text        not null,
  -- 平台侧账号唯一标识：GitHub id / 微信 unionid 优先 openid 兜底 / 抖音 open_id
  provider_account_id       text        not null,

  -- 凭据（一律 secretBox 密文）
  access_token_encrypted    text        not null,
  refresh_token_encrypted   text        null,
  token_type                text        null,
  scope                     text        null,
  access_token_expires_at   timestamptz null,
  refresh_token_expires_at  timestamptz null,

  status                    text        not null default 'active',
  -- 展示用快照：仅昵称 / 头像 URL，严禁写入任何凭据（R21 预留）
  profile_snapshot          jsonb       not null default '{}'::jsonb,

  authorized_at             timestamptz not null default now(),
  last_refreshed_at         timestamptz null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint oauth_connections_provider_check
    check (provider in ('github', 'wechat', 'douyin', 'xiaohongshu')),
  constraint oauth_connections_status_check
    check (status in ('active', 'expired', 'revoked'))
);

create unique index if not exists idx_oauth_connections_user_provider_account
  on oauth_connections (user_id, provider, provider_account_id);

create index if not exists idx_oauth_connections_user_id
  on oauth_connections (user_id);

-- ------------------------------------------------------------
-- (3) 授权临时态（state + PKCE verifier），TTL 10 分钟
--     state 明文作主键：它是 CSRF nonce 而非凭据，且需要作等值查询键。
--     code_verifier 属敏感值（泄漏即 PKCE 失效），必须加密。
--     redirect_uri 在发起时锁定并存此，回调换 token 时原样回传，
--     杜绝两侧推导不一致（微信严格匹配最高频故障点，ADR-05）。
-- ------------------------------------------------------------
create table if not exists oauth_auth_states (
  state                     text        primary key,
  provider                  text        not null,
  user_id                   bigint      not null references users(id) on delete cascade,
  code_verifier_encrypted   text        null,
  redirect_uri              text        not null,
  -- 授权完成后的站内回跳路径，只允许相对路径（防开放重定向）
  return_to                 text        null,
  expires_at                timestamptz not null,
  created_at                timestamptz not null default now(),

  constraint oauth_auth_states_provider_check
    check (provider in ('github', 'wechat', 'douyin', 'xiaohongshu'))
);

-- 惰性清理扫描用（DELETE WHERE expires_at < now()）
create index if not exists idx_oauth_auth_states_expires_at
  on oauth_auth_states (expires_at);
