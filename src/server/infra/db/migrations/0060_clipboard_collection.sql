-- ============================================================
-- 0060_clipboard_collection.sql —— 剪贴板快速收藏
--
-- 背景：用户从任意地方复制内容粘贴进 Superman，跳过审批直接入库，
--   作为高优先级选题。收藏内容固定 80 分，排在 RSS 文章前面。
--
-- articles 加列：
--   origin：内容来源（rss/clipboard/manual/trendradar/fever/github）
--   priority_score：优先级分数（收藏固定 80，RSS 走拟折打分）
--   feed_id 改为可空（收藏内容不属于任何订阅源）
--
-- 新表：
--   clips：收藏的原始内容快照（含图片/富文本），与 articles 1:1
--
-- 迁移安全性：全部 if not exists，幂等；
--   回滚 drop clips + 移除两列 + 恢复 feed_id not null 即可。
-- ============================================================

-- feed_id 改为可空（收藏内容无订阅源）
alter table articles alter column feed_id drop not null;

-- articles 加列
alter table articles
  add column if not exists origin text not null default 'rss',
  add column if not exists priority_score int;

-- 来源检查约束（幂等：先 drop if exists）
alter table articles drop constraint if exists articles_origin_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'articles_origin_check'
  ) then
    alter table articles
      add constraint articles_origin_check
      check (origin in ('rss', 'clipboard', 'manual', 'trendradar', 'fever', 'github'));
  end if;
end $$;

-- 索引：按来源+优先级排序（articles 用 fetched_at 而非 created_at）
create index if not exists idx_articles_origin_priority
  on articles (user_id, origin, priority_score desc nulls last, fetched_at desc);

-- 收藏原始内容表
create table if not exists clips (
  id           bigserial   primary key,
  article_id   bigint      not null references articles(id) on delete cascade,
  user_id      bigint      not null references users(id) on delete cascade,
  -- 原始粘贴内容（纯文本或 markdown）
  raw_content  text        not null default '',
  -- 原始 HTML（如果有）
  raw_html     text,
  -- 来源 URL（如果从网页复制）
  source_url   text,
  -- 来源标题
  source_title text,
  -- 图片 URLs（JSON 数组）
  image_urls   jsonb       default '[]'::jsonb,
  -- 收藏时的备注
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists idx_clips_article_id
  on clips (article_id);

create index if not exists idx_clips_user_created
  on clips (user_id, created_at desc);
