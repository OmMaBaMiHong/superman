-- 0020_favorite_vault_dir —— 收藏本地目录（Obsidian vault）关联：
-- 源文件（markdown 笔记 / 图片 / 视频）直接写进用户目录，库里只存链接。
create table if not exists user_favorite_dirs (
  user_id    bigint     primary key,
  dir        text       not null default '',
  updated_at timestamptz not null default now()
);
alter table articles add column if not exists vault_note_path text not null default '';
