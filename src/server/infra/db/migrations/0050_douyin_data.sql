-- ============================================================
-- 0050_douyin_data.sql —— 抖音数据统一存储（douyin-cli 数据源）
--
-- 背景：FeedFuse 工作台「抖音数据」Tab 需要直接读取 douyin-cli 的
--       评论 / 用户 / 视频 / 回复语料 / 推广活动等数据。
--       为统一数据源，douyin-cli 的存储层已由 SQLite 迁移至本库，
--       全部表放入独立 schema `douyin`，避免与 FeedFuse 现有表冲突。
--
-- 设计原则：
--   1. 独立 schema `douyin` 隔离，不触碰存量表。
--   2. 全部 create ... if not exists，可安全重复执行 / 回滚（drop schema 即可）。
--   3. 与 douyin-cli lib/memory/db.js 的建表 DDL 保持一致，
--      douyin-cli 侧也会在启动时幂等确保这些表存在（自愈）。
--   4. 布尔语义沿用 0/1 integer（与原有 JS 逻辑 !!row.is_xxx 兼容）。
-- ============================================================

create schema if not exists douyin;

-- ── events 事件流（命令审计，替代 audit.json 全表扫描路径）──
create table if not exists douyin.events (
  id           bigserial   primary key,
  ts           bigint      not null,
  session_id   text,
  command      text        not null,
  status       text        not null,
  duration_ms  bigint,
  aweme_id     text,
  uid          text,
  cid          text,
  args_json    text,
  summary_json text,
  error        text,
  result_path  text,
  platform     text        not null default 'douyin'
);

create index if not exists idx_events_video   on douyin.events(aweme_id, ts);
create index if not exists idx_events_uid     on douyin.events(uid, ts);
create index if not exists idx_events_command on douyin.events(command, ts);
create index if not exists idx_events_session on douyin.events(session_id);

-- ── users 用户实体 ──
create table if not exists douyin.users (
  uid           text        not null,
  platform      text        not null default 'douyin',
  sec_uid       text,
  nickname      text,
  first_seen    bigint,
  last_seen     bigint,
  comment_count integer     not null default 0,
  reply_count   integer     not null default 0,
  tier          text,
  tags_json     jsonb,
  notes         text,
  primary key (platform, uid)
);

create index if not exists idx_users_tier     on douyin.users(tier);
create index if not exists idx_users_nickname on douyin.users(nickname);

-- ── videos 视频实体 ──
create table if not exists douyin.videos (
  aweme_id            text        not null,
  platform            text        not null default 'douyin',
  title               text,
  author_uid          text,
  is_mine             integer     not null default 0,
  total_comments_seen integer     not null default 0,
  last_get_ts         bigint,
  last_post_ts        bigint,
  campaign_id         bigint,
  "desc"              text,
  type                text,
  tags_json           text,
  images_json         text,
  cover_url           text,
  briefing            text,
  context_refreshed_at bigint,
  -- 作品统计（my/user 命令落库，供「我的作品/他人分析」仪表盘展示）
  author_nickname     text,
  play_count          bigint      not null default 0,
  digg_count          bigint      not null default 0,
  comment_count       bigint      not null default 0,
  share_count         bigint      not null default 0,
  collect_count       bigint      not null default 0,
  create_time         bigint,
  duration            bigint,
  primary key (platform, aweme_id)
);

create index if not exists idx_videos_author on douyin.videos(author_uid);
create index if not exists idx_videos_mine   on douyin.videos(is_mine, create_time desc);

-- 兼容早期已建 videos 表（缺统计列）的存量 douyin schema，幂等补列
alter table douyin.videos add column if not exists author_nickname text;
alter table douyin.videos add column if not exists play_count    bigint not null default 0;
alter table douyin.videos add column if not exists digg_count    bigint not null default 0;
alter table douyin.videos add column if not exists comment_count bigint not null default 0;
alter table douyin.videos add column if not exists share_count   bigint not null default 0;
alter table douyin.videos add column if not exists collect_count bigint not null default 0;
alter table douyin.videos add column if not exists create_time   bigint;
alter table douyin.videos add column if not exists duration      bigint;

-- ── comments 评论实体 ──
create table if not exists douyin.comments (
  cid         text        not null,
  platform    text        not null default 'douyin',
  aweme_id    text        not null,
  uid         text,
  text        text,
  text_hash   text,
  digg        integer,
  created_at  bigint,
  is_sticker  integer     not null default 0,
  parent_cid  text,
  sentiment   text,
  priority    integer,
  replied     integer     not null default 0,
  reply_cid   text,
  first_seen  bigint,
  last_seen   bigint,
  primary key (platform, cid)
);

create index if not exists idx_comments_video  on douyin.comments(aweme_id, created_at);
create index if not exists idx_comments_uid    on douyin.comments(uid, created_at);
create index if not exists idx_comments_hash   on douyin.comments(text_hash);
create index if not exists idx_comments_parent on douyin.comments(parent_cid);
create index if not exists idx_comments_replied on douyin.comments(aweme_id, replied);

-- ── reply_corpus 回复语料库 ──
create table if not exists douyin.reply_corpus (
  id            bigserial   primary key,
  platform      text        not null default 'douyin',
  src_cid       text,
  src_text      text,
  reply_text    text        not null,
  reply_hash    text,
  reply_cid     text,
  aweme_id      text,
  posted_at     bigint,
  outcome       text,
  effectiveness double precision
);

create unique index if not exists idx_corpus_hash_unique on douyin.reply_corpus(platform, reply_hash);
create index if not exists idx_corpus_posted  on douyin.reply_corpus(platform, posted_at);
create index if not exists idx_corpus_outcome on douyin.reply_corpus(outcome);
create index if not exists idx_corpus_video   on douyin.reply_corpus(aweme_id);
create index if not exists idx_corpus_reply_cid on douyin.reply_corpus(platform, reply_cid);

-- ── failure_patterns 失败模式 ──
create table if not exists douyin.failure_patterns (
  id           bigserial   primary key,
  platform     text        not null default 'douyin',
  signature    text        not null,
  hit_count    integer     not null default 1,
  last_hit     bigint,
  example_text text,
  mitigation   text,
  unique (platform, signature)
);

create index if not exists idx_failures_lasthit on douyin.failure_patterns(last_hit desc);

-- ── campaigns + campaign_tasks 推广引擎 ──
create table if not exists douyin.campaigns (
  id            bigserial   primary key,
  platform      text        not null default 'douyin',
  name          text        not null,
  goal          text,
  template_json text,
  videos_json   text,
  filters_json  text,
  daily_quota   integer     not null default 50,
  per_user_quota integer    not null default 1,
  status        text        not null default 'draft',
  started_at    bigint,
  stats_json    text
);

create index if not exists idx_campaigns_status on douyin.campaigns(platform, status);

create table if not exists douyin.campaign_tasks (
  id             bigserial   primary key,
  campaign_id    bigint      not null,
  cid            text        not null,
  aweme_id       text,
  reply_text     text,
  scheduled_at   bigint,
  executed_at    bigint,
  outcome        text        not null default 'pending',
  failure_reason text,
  unique (campaign_id, cid)
);

create index if not exists idx_tasks_due      on douyin.campaign_tasks(outcome, scheduled_at);
create index if not exists idx_tasks_campaign on douyin.campaign_tasks(campaign_id, outcome);

-- ── llm_usage LLM Token 用量 ──
create table if not exists douyin.llm_usage (
  id                bigserial   primary key,
  ts                bigint      not null,
  model             text        not null,
  purpose           text,
  aweme_id          text,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  cost_estimate     double precision,
  duration_ms       bigint
);

create index if not exists idx_llm_usage_ts on douyin.llm_usage(ts desc);

-- ── drafts 回复草稿 ──
create table if not exists douyin.drafts (
  id          bigserial   primary key,
  platform    text        not null default 'douyin',
  aweme_id    text        not null,
  reply_to_cid text,
  text        text        not null,
  persona_id  text,
  created_at  bigint      not null,
  posted      integer     not null default 0
);

create index if not exists idx_drafts_aweme on douyin.drafts(aweme_id, created_at desc);

-- 兼容早期已建表（缺 platform 列）的存量 douyin schema，幂等补列
alter table douyin.drafts add column if not exists platform text not null default 'douyin';
