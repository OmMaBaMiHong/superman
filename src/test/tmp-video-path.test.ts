import { it } from 'vitest';
import { extractSubscriptionVideoUrl, fetchSubscriptionVideo } from '@/core/reader/video';
import { JSDOM } from 'jsdom';

it('复现宿主视频代理链路', async () => {
  const { Client } = await import('pg');
  const c = new Client({ connectionString: 'postgresql://feedfuse:feedfuse@127.0.0.1:55432/feedfuse' });
  await c.connect();
  const { rows } = await c.query("select content_html, content_full_source_url as source_url from articles where id=891352");
  await c.end();
  const html = rows[0].content_html ?? '';
  const url = extractSubscriptionVideoUrl({ content: html, mediaAttachments: [] });
  console.log('resolved url:', url?.slice(0, 100));
  try {
    const res = await fetchSubscriptionVideo(url!, { sourceUrl: rows[0].source_url, range: 'bytes=0-' });
    console.log('FETCH OK:', res.status, res.headers.get('content-type'), res.headers.get('content-length'));
    await res.body?.cancel();
  } catch (err) {
    console.log('FETCH FAILED:', err instanceof Error ? err.message : err);
  }
}, 60_000);
