-- ============================================================
-- 0009_credentials_unify.sql —— 凭据统一（与主迁移 0065_credentials_unify.sql 同内容）
-- 采集 Cookie 并入 platform_accounts，用 purpose 区分发布/采集/oauth。
-- ============================================================

alter table platform_accounts
  add column if not exists purpose text not null default 'publish',
  add column if not exists remark  text not null default '';

alter table platform_accounts drop constraint if exists platform_accounts_platform_check;
alter table platform_accounts add constraint platform_accounts_platform_check
  check (platform in ('wechat', 'douyin', 'xhs', 'bilibili', 'channels', 'weibo'));

alter table platform_accounts drop constraint if exists platform_accounts_purpose_check;
alter table platform_accounts add constraint platform_accounts_purpose_check
  check (purpose in ('publish', 'collect', 'oauth'));

drop index if exists idx_platform_accounts_user_platform_name;
create unique index if not exists idx_platform_accounts_user_platform_purpose_name
  on platform_accounts (user_id, platform, purpose, account_name);

create index if not exists idx_platform_accounts_user_purpose
  on platform_accounts (user_id, purpose);

do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'user_rsshub_cookies') then
    insert into platform_accounts (
      user_id, platform, account_name, cred_kind,
      credential_encrypted, credential_masked, status, purpose, remark, created_at, updated_at
    )
    select
      user_id,
      case provider when 'xiaohongshu' then 'xhs' else provider end,
      '', 'cookie', cookie_encrypted, masked_cookie, 'active', 'collect', remark, created_at, updated_at
    from user_rsshub_cookies
    on conflict (user_id, platform, purpose, account_name) do nothing;
  end if;
end $$;

drop table if exists user_rsshub_cookies;
