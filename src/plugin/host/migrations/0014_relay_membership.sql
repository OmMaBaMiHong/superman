-- ============================================================
-- 0014_relay_membership.sql —— 中转站会员权益
-- 与主迁移 0070_relay_membership.sql 同内容（幂等）。
-- ============================================================

create table if not exists relay_membership_group (
  group_id     bigint primary key check (group_id > 0),
  name         text not null,
  entitlements text[] not null default '{}',
  enabled      boolean not null default true,
  is_paid      boolean not null default true,
  plan_code    text,
  updated_at   timestamptz not null default now()
);

create table if not exists relay_membership_snapshot (
  user_id      text primary key,
  subscriptions jsonb not null default '[]',
  entitlements text[] not null default '{}',
  is_member    boolean not null default false,
  synced_at    timestamptz not null default now()
);

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

insert into relay_membership_group (group_id, name, entitlements, enabled, is_paid, plan_code)
values
  (1, '免费', array['collect.use', 'trending.read'], true, false, 'free'),
  (2, '会员', array['collect.use', 'trending.read', 'rewrite.execute', 'media.generate', 'knowledge.chat', 'models.relay'], true, true, 'month')
on conflict (group_id) do nothing;
