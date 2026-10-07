-- ============================================================
-- 0070_relay_membership.sql —— 中转站会员权益（对标 Skoob membership 模型）
-- 中转站（sub2api）拥有订阅；本插件配置「分组 → 权益点」映射并缓存短时订阅快照。
-- 插件侧同名迁移 0014_relay_membership.sql 同内容（幂等）。
-- ============================================================

-- 分组权益映射：中转站的 key 分组（group_id）→ 本插件功能权益点。可后台/SQL 维护。
create table if not exists relay_membership_group (
  group_id     bigint primary key check (group_id > 0),
  name         text not null,
  entitlements text[] not null default '{}',
  enabled      boolean not null default true,
  is_paid      boolean not null default true,
  plan_code    text,
  updated_at   timestamptz not null default now()
);

-- 订阅快照（短时镜像，5min TTL 由代码层控制）：中转站是唯一源头，这里是缓存。
create table if not exists relay_membership_snapshot (
  user_id      text primary key,
  subscriptions jsonb not null default '[]',
  entitlements text[] not null default '{}',
  is_member    boolean not null default false,
  synced_at    timestamptz not null default now()
);

-- 中转站授权凭据（token 加密落库；key/模型选择存明文 id，凭据本体不回显）。
create table if not exists relay_auth (
  user_id             text primary key,
  access_token_encrypted text not null default '',
  token_masked        text not null default '',
  user_json           jsonb not null default '{}',
  selected_key_id     text not null default '',
  selected_key_last4  text not null default '',
  selected_model      text not null default '',
  updated_at          timestamptz not null default now()
);

-- 默认分组 seed（可改）：免费组 + 会员组（权益点定义见 core/relay/entitlements.ts）
insert into relay_membership_group (group_id, name, entitlements, enabled, is_paid, plan_code)
values
  (1, '免费', array['collect.use', 'trending.read'], true, false, 'free'),
  (2, '会员', array['collect.use', 'trending.read', 'rewrite.execute', 'media.generate', 'knowledge.chat', 'models.relay'], true, true, 'month')
on conflict (group_id) do nothing;
