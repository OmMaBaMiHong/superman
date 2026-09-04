alter table feeds
  add column if not exists view text not null default 'article';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feeds_view_check'
  ) then
    alter table feeds
      add constraint feeds_view_check
      check (view in ('article', 'picture', 'video', 'social', 'digest'));
  end if;
end $$;

update feeds
set view = 'digest'
where kind = 'ai_digest';

update feeds
set view = 'video'
where kind = 'rss'
  and (
    lower(url) like 'rsshub://youtube/%'
    or lower(url) like 'https://www.youtube.com/%'
    or lower(url) like 'https://youtube.com/%'
  );
