-- ============================================================
-- 0053_pipelines.sql —— 编排层：洗稿流水线（M2）
--
-- 背景：治理层（0051）把文章审进 archived 后，分发编排层的第一条
--   pipeline 是「洗稿」：选题卡（archived article）→ LLM 按平台
--   profile 重写 → 原创度校验（bigram 相似度）→ 草稿入 drafts。
--   pg-boss 跑执行，pipeline_jobs 做业务视图。
--
-- 新表：
--   1. pipeline_jobs：任务业务视图（kind 先支持 'rewrite'，
--      voiceover/video 预留；status: queued/running/succeeded/failed）。
--   2. drafts：洗稿成稿（markdown），带与原文的 bigram 相似度与
--      原创度标记（ok / rewritten / needs_review）。
--
-- 迁移安全性：全部 create table/index if not exists，幂等；
--   回滚 drop 两张新表即可，不触碰任何存量表。
-- ============================================================

create table if not exists pipeline_jobs (
  id          bigserial   primary key,
  user_id     bigint      not null references users(id) on delete cascade,
  article_id  bigint      not null references articles(id) on delete cascade,
  kind        text        not null,
  platform    text        not null,
  status      text        not null default 'queued',
  input_json  jsonb       not null default '{}'::jsonb,
  output_json jsonb,
  error       text,
  attempts    int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint pipeline_jobs_kind_check
    check (kind in ('rewrite', 'voiceover', 'video')),
  constraint pipeline_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed'))
);

-- 幂等创建的业务去重：同文章同平台同 kind 只允许一个活跃（queued/running）任务。
create unique index if not exists idx_pipeline_jobs_active
  on pipeline_jobs (user_id, article_id, kind, platform)
  where status in ('queued', 'running');

create index if not exists idx_pipeline_jobs_user_status
  on pipeline_jobs (user_id, kind, status, created_at desc);

create table if not exists drafts (
  id               bigserial   primary key,
  user_id          bigint      not null references users(id) on delete cascade,
  article_id       bigint      not null references articles(id) on delete cascade,
  job_id           bigint      references pipeline_jobs(id) on delete set null,
  platform         text        not null,
  title            text        not null default '',
  body             text        not null default '',
  similarity_score numeric(4,3),
  originality_flag text        not null default 'ok',
  status           text        not null default 'draft',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint drafts_originality_flag_check
    check (originality_flag in ('ok', 'rewritten', 'needs_review')),
  constraint drafts_status_check
    check (status in ('draft', 'accepted', 'exported')),
  constraint drafts_similarity_score_check
    check (similarity_score is null or similarity_score between 0 and 1)
);

create index if not exists idx_drafts_user_article
  on drafts (user_id, article_id, platform, created_at desc);
