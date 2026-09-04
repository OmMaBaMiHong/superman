-- ============================================================
-- 0049_rsshub_platform_cookies.sql —— RSSHub 平台 Cookie 授权
--
-- 背景：抖音等平台的 RSSHub 路由需要登录态 Cookie 才能绕过 WAF，
--       否则会返回 "Empty post data. The request may be filtered by WAF."。
-- 设计原则（与 oauth_hub 一致）：
--   1. Cookie 属敏感凭据，落库前一律经 secretBox 加密（列名 *_encrypted）。
--   2. 每个用户每平台仅一条（唯一索引约束），重新填写即覆盖。
--   3. masked_cookie 只存打码快照，页面永不回显明文（安全红线）。
--
-- 迁移安全性：全部 create table if not exists / create index if not exists，
--   不触碰任何存量表与约束，可安全回滚（drop 两张新表即可）。
-- ============================================================

create table if not exists user_rsshub_cookies (
  id                 bigserial   primary key,
  user_id            bigint      not null references users(id) on delete cascade,
  provider           text        not null,
  cookie_encrypted   text        not null,
  -- 展示用打码快照（前 4 + **** + 后 4），明文永不落库、永不回显。
  masked_cookie      text        not null default '',
  remark             text        not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint user_rsshub_cookies_provider_check
    check (provider in ('douyin', 'xiaohongshu', 'weibo'))
);

create unique index if not exists idx_user_rsshub_cookies_user_provider
  on user_rsshub_cookies (user_id, provider);

create index if not exists idx_user_rsshub_cookies_user_id
  on user_rsshub_cookies (user_id);
