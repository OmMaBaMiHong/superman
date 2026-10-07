-- ============================================================
-- 0062_fix_null_feed_user_scope.sql —— 修复 user-scope 触发器对 NULL feed_id 的误报
--
-- 背景：0036 引入的 ensure_user_scoped_relations 在 articles / ai_digest_configs /
--   ai_digest_runs 三张表上，用
--     if not exists (select 1 from feeds where id = new.feed_id and user_id = new.user_id)
--   做同用户校验。但当 new.feed_id IS NULL 时（收藏/剪贴板内容无订阅源），
--   `id = NULL` 永不成立 → not exists 为真 → 误抛
--   'article must belong to same user as feed'，导致所有 feed_id 为空的插入失败。
--
--   feed_refresh_runs 分支本就写了 `new.feed_id is not null and ...` 守卫，
--   此处把同样的守卫补到另外三处。
--
-- 迁移安全性：create or replace function 幂等；触发器定义不变。
-- ============================================================

create or replace function ensure_user_scoped_relations()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'articles' then
    if new.feed_id is not null and not exists (select 1 from feeds where id = new.feed_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'articles_feed_user_scope_fkey',
              message = 'article must belong to same user as feed';
    end if;
    -- 重复源文章也是用户私有资源，必须和当前文章归属同一账号。
    if new.duplicate_of_article_id is not null and not exists (
      select 1 from articles where id = new.duplicate_of_article_id and user_id = new.user_id
    ) then
      raise foreign_key_violation
        using constraint = 'articles_duplicate_user_scope_fkey',
              message = 'duplicate source article must belong to same user as article';
    end if;
  elsif tg_table_name = 'ai_digest_configs' then
    if new.feed_id is not null and not exists (select 1 from feeds where id = new.feed_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'ai_digest_configs_feed_user_scope_fkey',
              message = 'ai digest config must belong to same user as feed';
    end if;
    if exists (
      select 1
      from unnest(new.selected_feed_ids) as selected(feed_id)
      left join feeds on feeds.id = selected.feed_id
      where feeds.id is null
        or feeds.user_id <> new.user_id
        or feeds.kind <> 'rss'
        or feeds.provider <> 'local_rss'
    ) then
      raise foreign_key_violation
        using constraint = 'ai_digest_configs_selected_feeds_user_scope_fkey',
              message = 'ai digest selected feeds must belong to same user';
    end if;
  elsif tg_table_name = 'ai_digest_runs' then
    if new.feed_id is not null and not exists (select 1 from feeds where id = new.feed_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'ai_digest_runs_feed_user_scope_fkey',
              message = 'ai digest run must belong to same user as feed';
    end if;
    if new.article_id is not null and not exists (
      select 1 from articles where id = new.article_id and user_id = new.user_id
    ) then
      raise foreign_key_violation
        using constraint = 'ai_digest_runs_article_user_scope_fkey',
              message = 'ai digest run article must belong to same user as run';
    end if;
  elsif tg_table_name = 'feed_refresh_runs' then
    if new.feed_id is not null and not exists (select 1 from feeds where id = new.feed_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'feed_refresh_runs_feed_user_scope_fkey',
              message = 'feed refresh run must belong to same user as feed';
    end if;
  elsif tg_table_name = 'article_tasks' then
    if not exists (select 1 from articles where id = new.article_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'article_tasks_article_user_scope_fkey',
              message = 'article task must belong to same user as article';
    end if;
  elsif tg_table_name = 'article_translation_sessions' then
    if not exists (select 1 from articles where id = new.article_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'article_translation_sessions_article_user_scope_fkey',
              message = 'translation session must belong to same user as article';
    end if;
  elsif tg_table_name = 'article_translation_segments' then
    if not exists (select 1 from article_translation_sessions where id = new.session_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'article_translation_segments_session_user_scope_fkey',
              message = 'translation segment must belong to same user as session';
    end if;
  elsif tg_table_name = 'article_translation_events' then
    if not exists (select 1 from article_translation_sessions where id = new.session_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'article_translation_events_session_user_scope_fkey',
              message = 'translation event must belong to same user as session';
    end if;
  elsif tg_table_name = 'article_ai_summary_sessions' then
    if not exists (select 1 from articles where id = new.article_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'article_ai_summary_sessions_article_user_scope_fkey',
              message = 'ai summary session must belong to same user as article';
    end if;
    if new.superseded_by_session_id is not null and not exists (
      select 1 from article_ai_summary_sessions where id = new.superseded_by_session_id and user_id = new.user_id
    ) then
      raise foreign_key_violation
        using constraint = 'article_ai_summary_sessions_superseded_user_scope_fkey',
              message = 'ai summary superseding session must belong to same user';
    end if;
  elsif tg_table_name = 'article_ai_summary_events' then
    if not exists (select 1 from article_ai_summary_sessions where id = new.session_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'article_ai_summary_events_session_user_scope_fkey',
              message = 'ai summary event must belong to same user as session';
    end if;
  elsif tg_table_name = 'article_media_attachments' then
    if not exists (select 1 from articles where id = new.article_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'article_media_attachments_article_user_scope_fkey',
              message = 'media attachment must belong to same user as article';
    end if;
  elsif tg_table_name = 'feed_favicons' then
    if not exists (select 1 from feeds where id = new.feed_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'feed_favicons_feed_user_scope_fkey',
              message = 'feed favicon must belong to same user as feed';
    end if;
  elsif tg_table_name = 'feed_refresh_run_items' then
    if not exists (
      select 1
      from feed_refresh_runs
      join feeds on feeds.id = new.feed_id
      where feed_refresh_runs.id = new.run_id
        and feed_refresh_runs.user_id = new.user_id
        and feeds.user_id = new.user_id
    ) then
      raise foreign_key_violation
        using constraint = 'feed_refresh_run_items_user_scope_fkey',
              message = 'feed refresh run item must belong to same user as run and feed';
    end if;
  elsif tg_table_name = 'fever_feed_mappings' then
    if not exists (
      select 1
      from fever_accounts
      join feeds on feeds.id = new.local_feed_id
      where fever_accounts.id = new.fever_account_id
        and fever_accounts.user_id = new.user_id
        and feeds.user_id = new.user_id
    ) then
      raise foreign_key_violation
        using constraint = 'fever_feed_mappings_user_scope_fkey',
              message = 'fever mapping must belong to same user as account and local feed';
    end if;
  elsif tg_table_name = 'fever_item_mappings' then
    if not exists (
      select 1
      from fever_accounts
      join feeds on feeds.id = new.local_feed_id
      join articles on articles.id = new.local_article_id
      where fever_accounts.id = new.fever_account_id
        and fever_accounts.user_id = new.user_id
        and feeds.user_id = new.user_id
        and articles.user_id = new.user_id
    ) then
      raise foreign_key_violation
        using constraint = 'fever_item_mappings_user_scope_fkey',
              message = 'fever mapping must belong to same user as account, local feed and article';
    end if;
  elsif tg_table_name = 'fever_sync_states' then
    if not exists (select 1 from fever_accounts where id = new.fever_account_id and user_id = new.user_id) then
      raise foreign_key_violation
        using constraint = 'fever_sync_states_user_scope_fkey',
              message = 'fever sync state must belong to same user as account';
    end if;
  elsif tg_table_name = 'ai_digest_run_sources' then
    if not exists (
      select 1
      from ai_digest_runs
      join articles on articles.id = new.source_article_id
      where ai_digest_runs.id = new.run_id
        and ai_digest_runs.user_id = new.user_id
        and articles.user_id = new.user_id
    ) then
      raise foreign_key_violation
        using constraint = 'ai_digest_run_sources_user_scope_fkey',
              message = 'ai digest source must belong to same user as run and article';
    end if;
  end if;

  return new;
end;
$$;
