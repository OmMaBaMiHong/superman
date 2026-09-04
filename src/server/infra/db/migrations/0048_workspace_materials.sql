-- ============================================================
-- 0048_workspace_materials.sql —— 工作台工作区素材持久化存储
--
-- 用途：
--   1. 保存用户在工作区上传的视频 / 文章 / 文件素材
--   2. 保存视频文案（语音识别结果），供文案提取功能复用
--   3. 为后续「去剪辑」（OpenChatCut）与 RAG 知识库接入提供素材数据源
--
-- 迁移安全性：
--   全部为 create table if not exists / create index if not exists，
--   不触碰任何存量表与约束，可安全回滚（drop 表即可）。
-- ============================================================

create table if not exists workspace_materials (
  id            bigserial   primary key,
  user_id       bigint      not null references users(id) on delete cascade,

  -- 素材类型：'video' 视频 | 'file' 文章/文件
  kind          text        not null default 'file',

  -- 素材来源信息
  title         text        not null default '',
  file_name     text        not null,
  file_path     text        not null,
  file_size     bigint      null,
  mime_type     text        null,

  -- 文案信息（视频专用）
  transcript_text         text        null,
  transcript_source       text        null,   -- 'whisper' | 'subtitle'
  transcript_language     text        null,
  transcript_extracted_at timestamptz null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_workspace_materials_user_id
  on workspace_materials (user_id);

create index if not exists idx_workspace_materials_kind
  on workspace_materials (kind);
