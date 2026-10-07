import { Readable } from 'node:stream';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

// Only temporary tables on a dedicated connection; existing user data is never changed.
describe.skipIf(!process.env.TEST_DATABASE_URL)('DSH subscription reader · PostgreSQL', () => {
  let pool: Pool;
  let db: PoolClient;
  let handler: ReturnType<typeof createApiHandler>;
  let cookie: string;

  async function request(path: string, method = 'GET', payload = {}, authenticated = true) {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), {
      method, url: `/s/api${path}`, headers: authenticated ? { cookie } : {},
    });
    let status = 0;
    let body = '';
    const res = {
      writeHead(value: number) { status = value; },
      end(value?: string | Buffer) { body += value?.toString() ?? ''; },
    };
    await handler(req as never, res as never);
    return { status, ...JSON.parse(body) };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    db = await pool.connect();
    await db.query('begin');
    await db.query(`
      create temporary table feeds (
        id bigint primary key, user_id bigint, title text, url text, site_url text,
        icon_url text, kind text default 'rss', view text default 'articles', enabled boolean default true,
        last_fetch_status int, last_fetch_error text, last_fetched_at timestamptz
      );
      create temporary table articles (
        id bigint primary key, user_id bigint, feed_id bigint, title text, title_original text,
        summary text, author text, link text, preview_image_url text,
        content_html text, content_full_html text, published_at timestamptz, fetched_at timestamptz default now(),
        is_read boolean default false, governance_status text default 'candidate',
        governance_updated_at timestamptz, filter_status text default 'pending'
      );
      create temporary table article_media_attachments (
        id bigint primary key, user_id bigint, article_id bigint, url text, mime_type text,
        size_bytes bigint, duration_seconds double precision, position int default 0
      );
    `);
    const auth = createAuth({ db: null, secret: '' });
    const session = (await auth.login('admin', 'superman-dev'))!;
    auth.issueCookie({ setHeader(_key: string, value: string) {
      cookie = `${SESSION_COOKIE}=${/superman_session=([^;]+)/.exec(value)![1]}`;
    }} as never, session);
    handler = createApiHandler({ auth, db, staticRoot: '/nonexistent' });
  });

  beforeEach(async () => {
    await db.query('truncate pg_temp.article_media_attachments, pg_temp.articles, pg_temp.feeds');
    await db.query(`
      insert into feeds(id,user_id,title,url,site_url) values
        (1,1,'同名博主','https://example.com/rss','https://example.com'),
        (2,1,'同名博主','rsshub://bilibili/user/video/2','https://space.bilibili.com/2'),
        (3,1,'暂无作品的博主','https://empty.example/rss',null),
        (9,2,'另一用户','https://private.example/rss',null);
      insert into articles(id,user_id,feed_id,title,link,published_at,content_html) values
        (11,1,1,'未治理的文章','https://example.com/11','2026-09-09T08:00:00Z','<p>文章正文</p>'),
        (12,1,2,'博主视频','https://www.bilibili.com/video/BV1xx','2026-09-09T08:00:00Z','<p>视频介绍</p>'),
        (13,1,1,'旧文章','https://example.com/13','2026-09-08T08:00:00Z','<p>旧正文</p>'),
        (99,2,9,'私有文章','https://private.example/99','2026-09-09T09:00:00Z','私有正文');
      insert into article_media_attachments(id,user_id,article_id,url,mime_type,duration_seconds)
        values(1,1,12,'https://example.com/video.mp4','video/mp4',60);
    `);
  });

  afterAll(async () => { await db?.query('rollback'); db?.release(); await pool?.end(); });

  it('lists every subscribed blogger including zero works, with unread and latest work', async () => {
    const result = await request('/reader/feeds');
    expect(result.status).toBe(200);
    expect(result.data.items).toHaveLength(3);
    expect(result.data.items.find((f: { id: string }) => f.id === '3')).toMatchObject({ articleCount: 0, unreadCount: 0 });
    expect(result.data.items.find((f: { id: string }) => f.id === '1')).toMatchObject({ unreadCount: 2, latestTitle: '未治理的文章' });
  });

  it('paginates all works without governance or pending-filter exclusions or skipped cursor rows', async () => {
    const first = await request('/reader/items?limit=2');
    expect(first.status).toBe(200);
    expect(first.data.items.map((a: { id: string }) => a.id)).toEqual(['12', '11']);
    const second = await request(`/reader/items?limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`);
    expect(second.data.items.map((a: { id: string }) => a.id)).toEqual(['13']);
    expect(second.data.nextCursor).toBeNull();
  });

  it('filters by stable feed id and media type', async () => {
    const feed = await request('/reader/items?feedId=1');
    expect(feed.status).toBe(200);
    expect(feed.data.items.map((a: { id: string }) => a.id)).toEqual(['11', '13']);
    const videos = await request('/reader/items?type=video');
    expect(videos.data.items.map((a: { id: string }) => a.id)).toEqual(['12']);
    const articles = await request('/reader/items?type=article');
    expect(articles.data.items).toHaveLength(2);
  });

  it('keeps microsecond cursor precision when publication time is missing', async () => {
    await db.query(`update articles set published_at=null, fetched_at='2026-09-09T09:00:00.000002Z' where id=11;
      update articles set published_at=null, fetched_at='2026-09-09T09:00:00.000001Z' where id=13;`);
    const first = await request('/reader/items?feedId=1&limit=1');
    expect(first.data.items[0].id).toBe('11');
    const second = await request(`/reader/items?feedId=1&limit=1&cursor=${encodeURIComponent(first.data.nextCursor)}`);
    expect(second.data.items[0]?.id).toBe('13');
  });

  it('returns content and playable attachments; marks read without changing candidate membership', async () => {
    const detail = await request('/reader/items/12');
    expect(detail.status).toBe(200);
    expect(detail.data.item).toMatchObject({ content: '<p>视频介绍</p>', contentType: 'video' });
    expect(detail.data.item.mediaAttachments[0].url).toBe('https://example.com/video.mp4');
    expect(detail.data.item.hasPlayableVideo).toBe(true);
    expect((await request('/reader/items/12/read', 'POST')).status).toBe(200);
    expect((await request('/reader/feeds')).data.items.find((f: { id: string }) => f.id === '2').unreadCount).toBe(0);
    expect((await db.query('select governance_status from articles where id=12')).rows[0].governance_status).toBe('candidate');
  });

  it('recognizes legacy Douyin play links without media attachments', async () => {
    await db.query(`update articles set link='https://www.douyin.com/video/123', content_html='<a href="https://www.douyin.com/aweme/v1/play/?video_id=v123&amp;line=0">视频直链</a>', content_full_html='<p>仅有分析后的正文</p>' where id=11`);
    expect((await request('/reader/items/11')).data.item.hasPlayableVideo).toBe(true);
    expect((await request('/reader/items/99/video')).status).toBe(404);
    expect((await request('/reader/items/11/video', 'GET', {}, false)).status).toBe(401);
  });

  it('lets <video> tag requests authenticate via ?access_token= (DSH 壳无 cookie、媒体标签无自定义头)', async () => {
    // 无头无 cookie → 401；同一请求带合法会话令牌的查询串 → 通过鉴权（404 = 已进入业务层）
    expect((await request('/reader/items/99/video', 'GET', {}, false)).status).toBe(401);
    const token = /superman_session=([^;]+)/.exec(cookie)![1];
    const unauth = Object.assign(Readable.from([]), {
      method: 'GET', url: '/s/api/reader/items/99/video?access_token=' + encodeURIComponent(token), headers: {},
    });
    let status = 0; let body = '';
    const res = { writeHead: (v: number) => { status = v; }, end: (v?: string | Buffer) => { body += v?.toString() ?? ''; } };
    await handler(unauth as never, res as never);
    expect(status).toBe(404);
    expect(JSON.parse(body).error.message).toBe('作品不存在');
  });

  it('adds a work to the existing topic pool idempotently, retaining it in reading and preserving used status', async () => {
    expect((await request('/reader/items/11/candidate', 'POST')).status).toBe(200);
    expect((await request('/reader/items/11/candidate', 'POST')).status).toBe(200);
    expect((await db.query('select governance_status from articles where id=11')).rows[0].governance_status).toBe('archived');
    expect((await request('/reader/items')).data.items.find((a: { id: string }) => a.id === '11').inCandidatePool).toBe(true);
    await db.query("update articles set governance_status='used' where id=11");
    await request('/reader/items/11/candidate', 'POST');
    expect((await db.query('select governance_status from articles where id=11')).rows[0].governance_status).toBe('used');
  });

  it('rejects unauthenticated access, invalid cursors, and another user’s reads or writes', async () => {
    expect((await request('/reader/feeds', 'GET', {}, false)).status).toBe(401);
    expect((await request('/reader/items?cursor=invalid')).status).toBe(400);
    for (const [path, method] of [['/reader/items/99', 'GET'], ['/reader/items/99/read', 'POST'], ['/reader/items/99/candidate', 'POST']]) {
      expect((await request(path, method)).status).toBe(404);
    }
    expect((await db.query('select is_read,governance_status from articles where id=99')).rows[0]).toMatchObject({ is_read: false, governance_status: 'candidate' });
  });
});
