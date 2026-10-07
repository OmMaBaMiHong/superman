-- ============================================================
-- 0065_credentials_unify.sql —— 凭据统一：采集 Cookie 并入 platform_accounts
--
-- 背景（用户拍板）：工作台要保存多平台的「授权登录 / Cookie / Token」。
--   原先分两套表：
--     platform_accounts    发布授权（公众号 app_secret / 抖音·小红书扫码 cookie / oauth）
--     user_rsshub_cookies  采集 cookie（RSSHub 抓取 + yt-dlp 文案提取）
--   两套加密同源（secretBox），现统一到 platform_accounts，用 purpose 区分用途。
--
-- 变更：
--   + purpose  ('publish' 发布 / 'collect' 采集 / 'oauth' 三方授权)，默认 publish
--   + remark   备注（采集 cookie 的说明）
--   平台约束放宽：+ weibo（采集 cookie 平台）
--   唯一键 (user_id, platform, account_name) → (user_id, platform, purpose, account_name)
--     （同平台可同时存在「发布」「采集」两条凭据）
--   迁移 user_rsshub_cookies（provider xiaohongshu → xhs）后删除旧表
--
-- 迁移安全性：全部 if not exists / 幂等；旧表通常为空（用户未配过）。
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

-- 迁移历史采集 cookie（provider xiaohongshu → xhs），表不存在或为空则跳过
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
