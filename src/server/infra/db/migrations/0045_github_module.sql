-- ============================================================
-- 0045_github_module.sql —— GitHub 模块 MVP（T01 基础设施与数据契约）
--
-- 设计原则（见 docs/arch-github-module.md ADR-01）：
--   GitHub 不是平行的数据体系，而是 feeds 表上的第三种 kind。
--   GitHub 专属字段用 1:1 挂载表承载：
--     github_repo_subscriptions -> feeds
--     github_article_items      -> articles
--   这样三栏列表 / 已读 / 搜索 / 高亮 / AI 摘要全部零改动复用。
--
-- 迁移安全性：
--   全部为 add column if not exists / 索引新建 / CHECK 放宽
--   （drop constraint if exists + 重建为更宽集合），不存在收紧型变更，
--   对存量数据零影响，可安全回滚（drop 新表 + 恢复窄 CHECK）。
-- ============================================================

-- ------------------------------------------------------------
-- (1) feeds.kind 扩展：rss | ai_digest | github
--     存量库里 feeds_kind_check 已经存在且为窄集合，必须先 drop 再重建，
--     否则 add constraint 会因重名直接失败。
-- ------------------------------------------------------------
alter table feeds drop constraint if exists feeds_kind_check;
alter table feeds
  add constraint feeds_kind_check check (kind in ('rss', 'ai_digest', 'github'));

-- ------------------------------------------------------------
-- (2) feeds.view 扩展（左栏 Tab 归类，沿用 ai_digest 的 view='digest' 模式）
-- ------------------------------------------------------------
alter table feeds drop constraint if exists feeds_view_check;
alter table feeds
  add constraint feeds_view_check
  check (view in ('article', 'picture', 'video', 'social', 'digest', 'github'));

-- ------------------------------------------------------------
-- (3) GitHub 仓库订阅配置（1:1 挂在 feeds 上，对标 ai_digest_configs）
--     refresh_interval / enabled 复用 feeds.fetch_interval_minutes / feeds.enabled，
--     此表只承载 GitHub 专属配置与同步健康状态。
-- ------------------------------------------------------------
create table if not exists github_repo_subscriptions (
  feed_id                   bigint primary key references feeds(id) on delete cascade,
  user_id                   bigint not null references users(id) on delete cascade,

  -- 仓库标识
  owner                     text   not null,
  repo                      text   not null,
  repo_html_url             text   not null,

  -- 订阅配置
  -- content_types 用 text[]（与 filtered_by / selected_feed_ids 一致，非 JSONB）。
  -- CHECK 按 release/issue/pr/commit 四值提前落地，MVP 行为只开 release，
  -- P1 扩展 Issue/PR 时零迁移。
  content_types             text[] not null default '{release}',
  include_prerelease        boolean not null default false,

  -- 仓库元信息快照（设置页 / 发现页展示用，同步时刷新）
  repo_description          text   null,
  repo_language             text   null,
  repo_stargazers           int    null,
  repo_avatar_url           text   null,
  repo_metadata_synced_at   timestamptz null,

  -- 增量抓取状态（ETag 条件请求：304 不计入 GitHub 速率配额）
  releases_etag             text   null,
  last_release_published_at timestamptz null,

  -- 调度与健康状态（R05）
  last_synced_at            timestamptz null,   -- 上次成功
  last_sync_attempt_at      timestamptz null,   -- 上次尝试
  next_sync_at              timestamptz null,   -- 下次计划
  consecutive_failures      int    not null default 0,
  rate_limited_until        timestamptz null,
  rate_limit_remaining      int    null,
  last_error_code           text   null,
  last_error                text   null,
  last_raw_error            text   null,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint github_repo_subscriptions_content_types_check
    check (
      content_types <@ array['release', 'issue', 'pr', 'commit']::text[]
      and coalesce(array_length(content_types, 1), 0) >= 1
    ),
  constraint github_repo_subscriptions_failures_non_negative
    check (consecutive_failures >= 0)
);

-- 同一用户同一仓库只能订阅一次（大小写不敏感，与 categories_name_unique 同风格）
create unique index if not exists github_repo_subscriptions_user_repo_unique
  on github_repo_subscriptions (user_id, lower(owner), lower(repo));

-- Worker tick 扫描路径：where next_sync_at <= now() order by next_sync_at
create index if not exists github_repo_subscriptions_due_idx
  on github_repo_subscriptions (next_sync_at asc nulls first);

create index if not exists github_repo_subscriptions_user_idx
  on github_repo_subscriptions (user_id);

-- ------------------------------------------------------------
-- (4) GitHub 条目扩展（1:1 挂在 articles 上）
--     标题 / 正文 / 作者 / 链接 / 已读 / 收藏全部复用 articles，
--     此表只承载 GitHub 专属元信息。
-- ------------------------------------------------------------
create table if not exists github_article_items (
  article_id     bigint primary key references articles(id) on delete cascade,
  user_id        bigint not null references users(id) on delete cascade,
  feed_id        bigint not null references feeds(id) on delete cascade,

  gh_type        text   not null,          -- release | issue | pr | commit
  gh_id          text   not null,          -- GitHub 数字 id（字符串存储，避免 bigint 溢出歧义）
  gh_node_id     text   null,              -- GraphQL node_id，便于 P1 迁移
  gh_number      int    null,              -- issue / pr 编号（release 为 null）

  tag_name       text   null,              -- Release tag，如 v19.0.0
  is_prerelease  boolean not null default false,
  is_draft       boolean not null default false,
  body_markdown  text   null,              -- 原始 Markdown，供 P1 重渲染 / AI 摘要 / Goose 分析
  html_url       text   not null,

  created_at     timestamptz not null default now(),

  constraint github_article_items_gh_type_check
    check (gh_type in ('release', 'issue', 'pr', 'commit'))
);

create index if not exists github_article_items_feed_type_idx
  on github_article_items (feed_id, gh_type);

create unique index if not exists github_article_items_feed_type_ghid_unique
  on github_article_items (feed_id, gh_type, gh_id);

-- ------------------------------------------------------------
-- (5) GitHub Token 加密存储（AES-256-GCM，密文格式 v1:iv:tag:ct）
--     明文永不落库，见 src/server/infra/crypto/secretBox.ts
-- ------------------------------------------------------------
alter table user_settings
  add column if not exists github_token_encrypted text not null default '';

-- ------------------------------------------------------------
-- (6) 应用级密钥（env FEEDFUSE_SECRET_KEY 缺省时的兜底密钥源）
--     生产环境推荐用 env 注入；此列保证 Docker 用户零配置可用。
-- ------------------------------------------------------------
alter table app_settings
  add column if not exists secret_encryption_key text not null default '';

update app_settings
set secret_encryption_key = encode(gen_random_bytes(32), 'hex')
where id = 1 and coalesce(secret_encryption_key, '') = '';
