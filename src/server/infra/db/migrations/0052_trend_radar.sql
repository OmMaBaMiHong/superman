-- ============================================================
-- 0052_trend_radar.sql —— 热点雷达（TrendRadar 接入）数据模型
--
-- 背景：Phase 1b 把 TrendRadar 的 11 平台热榜接进 Superman。
--   主链路是 pg-boss 定时 job `trendradar.sync` 读 TrendRadar 的
--   output/news/YYYY-MM-DD.db（SQLite）upsert 进本表；
--   webhook（POST /api/ingest/trendradar）只做实时触达，写同一张表。
--
-- 变更内容：
--   新表 trend_radar_items：按 user_id + platform + url + source_date 幂等去重，
--   记录首见/末见时间、排名、原始 payload，以及「转为选题」后的
--   promoted_at / promoted_article_id 回链。
--
-- 鉴权 token：不落库，走 env TRENDRADAR_INGEST_TOKEN（与 AUTH_INITIAL_PASSWORD
--   / IMAGE_PROXY_SECRET 同一模式），避免 token 进数据库后被低权限查询读出。
--
-- 迁移安全性：全部 if not exists，幂等；回滚 drop table trend_radar_items 即可。
-- ============================================================

create table if not exists trend_radar_items (
  id                  bigserial   primary key,
  user_id             bigint      not null references users(id) on delete cascade,
  platform            text        not null,
  platform_name       text        not null default '',
  title               text        not null,
  url                 text        not null default '',
  rank                int,
  hot_value           text        not null default '',
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  payload_json        jsonb       not null default '{}'::jsonb,
  source_date         date        not null,
  promoted_at         timestamptz,
  promoted_article_id bigint      references articles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 幂等去重：同一用户同一天同一平台同一 URL 只保留一行，重复写入走 upsert。
create unique index if not exists trend_radar_items_unique
  on trend_radar_items (user_id, platform, url, source_date);

create index if not exists idx_trend_radar_items_today
  on trend_radar_items (user_id, source_date desc, platform, rank);

-- 「转为选题」会挂载一个每用户一条的合成 feed（kind='trend_radar'），
-- 需要先放宽 feeds.kind 约束（沿用 0045 的 drop + 重建幂等模式）。
alter table feeds drop constraint if exists feeds_kind_check;
alter table feeds
  add constraint feeds_kind_check check (kind in ('rss', 'ai_digest', 'github', 'trend_radar'));
