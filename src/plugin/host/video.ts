import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { fetchSubscriptionVideo } from '@/core/reader/video';

/** Stop upstream transfer when the player closes; stream failures must not escape into DSH. */
export async function streamSubscriptionVideo(req: IncomingMessage, res: ServerResponse, source: {
  videoUrl: string; sourceUrl: string | null;
}): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    const upstream = await fetchSubscriptionVideo(source.videoUrl, {
      sourceUrl: source.sourceUrl, range: req.headers.range, signal: controller.signal,
    });
    const headers: Record<string, string> = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    if (upstream.status === 416) {
      await upstream.body?.cancel();
      delete headers['content-length'];
      res.writeHead(416, headers);
      res.end();
      return;
    }
    res.writeHead(upstream.status, headers);
    await pipeline(Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>), res);
  } catch (error) {
    if (res.headersSent || res.destroyed) res.destroy();
    else throw error;
  } finally { res.off('close', abort); }
}
