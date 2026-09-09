import { createServer, get, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamSubscriptionVideo } from '@/plugin/host/video';
import { fetchSubscriptionVideo } from '@/core/reader/video';

vi.mock('@/core/reader/video', () => ({ fetchSubscriptionVideo: vi.fn() }));
let server: Server;
afterEach(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function start() {
  server = createServer((req, res) => {
    void streamSubscriptionVideo(req, res, { videoUrl: 'https://cdn.example/a.mp4', sourceUrl: 'https://www.douyin.com/video/123' })
      .catch(() => { res.writeHead(502); res.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server port');
  return `http://127.0.0.1:${address.port}`;
}

describe('DSH video stream', () => {
  it('streams the selected byte range and preserves media response headers', async () => {
    vi.mocked(fetchSubscriptionVideo).mockResolvedValue(new Response('data', { status: 206, headers: {
      'content-type': 'video/mp4', 'content-length': '4', 'content-range': 'bytes 10-13/100', 'accept-ranges': 'bytes',
    } }));
    const url = await start();
    const result = await new Promise<{ status?: number; body: string; range?: string; type?: string }>((resolve, reject) => {
      get(url, { headers: { range: 'bytes=10-13' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body, range: res.headers['content-range'], type: res.headers['content-type'] }));
      }).on('error', reject);
    });
    expect(result).toEqual({ status: 206, body: 'data', range: 'bytes 10-13/100', type: 'video/mp4' });
    expect(fetchSubscriptionVideo).toHaveBeenCalledWith('https://cdn.example/a.mp4', expect.objectContaining({ range: 'bytes=10-13' }));
  });

  it('cancels the upstream when the user closes the player', async () => {
    const cancel = vi.fn();
    vi.mocked(fetchSubscriptionVideo).mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel,
    }), { headers: { 'content-type': 'video/mp4' } }));
    const url = await start();
    await new Promise<void>((resolve, reject) => {
      const request = get(url, (res) => { res.once('data', () => { request.destroy(); resolve(); }); });
      request.once('error', reject);
    });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetchSubscriptionVideo).mock.calls.at(-1)?.[1].signal?.aborted).toBe(true);
  });
});
