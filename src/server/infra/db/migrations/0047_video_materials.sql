-- ============================================================
-- 0047_video_materials.sql —— 视频素材持久化存储
--
-- 用途：
--   1. 保存视频文案（字幕/语音识别结果）
--   2. 保存下载视频的文件路径
--   3. 为后续口播剪辑功能提供素材数据源
--
-- 迁移安全性：
--   全部为 create table if not exists / create index if not exists，
--   不触碰任何存量表与约束，可安全回滚（drop 表即可）。
-- ============================================================

create table if not exists video_materials (
  id                        bigserial   primary key,
  article_id                bigint      not null references articles(id) on delete cascade,
  user_id                   bigint      not null references users(id) on delete cascade,

  -- 视频来源信息
  video_url                 text        not null,
  video_title               text        not null default '',
  provider                  text        not null default '',

  -- 文案信息
  transcript_text           text        null,
  transcript_source         text        null,   -- 'subtitle' | 'whisper'
  transcript_language       text        null,
  transcript_extracted_at   timestamptz null,

  -- 下载信息
  video_file_path           text        null,
  video_file_name           text        null,
  video_file_size           bigint      null,
  video_downloaded_at       timestamptz null,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- 每篇文章每个用户只能有一条素材记录
  constraint video_materials_article_user_unique unique (article_id, user_id)
);

create index if not exists idx_video_materials_article_id
  on video_materials (article_id);

create index if not exists idx_video_materials_user_id
  on video_materials (user_id);