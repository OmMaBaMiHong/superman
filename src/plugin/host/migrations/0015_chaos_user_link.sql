-- Chaos 数据中台用户身份关联（双身份标准：产品 Key + Chaos User ID）。
-- 用户在本产品完成 Chaos OAuth 授权后，绑定中台用户并加密保存会话令牌对。
alter table users
  add column if not exists chaos_user_id text,
  add column if not exists chaos_tokens_encrypted text,
  add column if not exists chaos_linked_at timestamptz;
