-- ============================================================
-- 0012_platform_accounts_kuaishou.sql —— SAU 扫码平台扩展（P2e-4）
-- 与主迁移 0068_platform_accounts_kuaishou.sql 同内容（幂等）。
-- ============================================================

alter table platform_accounts drop constraint if exists platform_accounts_platform_check;

alter table platform_accounts
  add constraint platform_accounts_platform_check
  check (platform in ('wechat', 'douyin', 'xhs', 'bilibili', 'channels', 'kuaishou'));

-- 发布登记表同步纳入视频号/快手
alter table published_posts drop constraint if exists published_posts_platform_check;

alter table published_posts
  add constraint published_posts_platform_check
  check (platform in ('bilibili', 'douyin', 'xhs', 'wechat', 'channels', 'kuaishou', 'other'));
