/**
 * /s/api/waveforge/* 子路由：DSH 工作台「生成同款视频」的服务端通道。
 *   POST create                        创建复刻任务（202 + {id}）
 *   GET  job/<id>                      任务状态
 *   GET  job/<id>/result               任务结果
 *   GET  job/<id>/preview/<...path>    分镜预览文件（storyboard.html + photos/）
 * 全部需登录（与其它 /s/api 端点同口径）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './routes.js';
import {
  createRemakeJob,
  getJob,
  getJobResult,
  openPreviewFile,
} from '@/server/services/waveforge/waveforgeService';

export async function handleWaveforgeRoute(
  sub: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (sub === 'create' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return json(res, 400, { ok: false, error: '请求体不是 JSON' });
    }
    try {
      const result = await createRemakeJob({
        templateId: String(body.templateId ?? ''),
        storeName: String(body.storeName ?? ''),
        note: typeof body.note === 'string' ? body.note : undefined,
        session: String(body.session ?? ''),
        benchmarkUrl: typeof body.benchmarkUrl === 'string' ? body.benchmarkUrl : undefined,
        sourceText: typeof body.sourceText === 'string' ? body.sourceText : undefined,
        photos: Array.isArray(body.photos)
          ? (body.photos as Array<{ name?: unknown; base64?: unknown }>).map((p) => ({
              name: String(p.name ?? ''),
              base64: String(p.base64 ?? ''),
            }))
          : [],
      });
      return json(res, 202, { ok: true, id: result.id });
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : '创建任务失败',
      });
    }
  }

  const jobMatch = sub.match(/^job\/([^/]+)$/);
  if (jobMatch && req.method === 'GET') {
    const job = await getJob(decodeURIComponent(jobMatch[1]!)).catch((error: unknown) => {
      json(res, 502, { ok: false, error: error instanceof Error ? error.message : '引擎不可达' });
      return null;
    });
    if (!job) return json(res, 404, { ok: false, error: '任务不存在' });
    return json(res, 200, { ok: true, ...job });
  }

  const resultMatch = sub.match(/^job\/([^/]+)\/result$/);
  if (resultMatch && req.method === 'GET') {
    const result = await getJobResult(decodeURIComponent(resultMatch[1]!)).catch((error: unknown) => {
      json(res, 502, { ok: false, error: error instanceof Error ? error.message : '引擎不可达' });
      return null;
    });
    if (!result) return json(res, 409, { ok: false, error: '成片还没好' });
    return json(res, 200, { ok: true, ...result });
  }

  const previewMatch = sub.match(/^job\/([^/]+)\/preview\/(.+)$/);
  if (previewMatch && req.method === 'GET') {
    const file = await openPreviewFile(decodeURIComponent(previewMatch[1]!), decodeURIComponent(previewMatch[2]!));
    if (!file) return json(res, 404, { ok: false, error: '预览文件不存在' });
    res.writeHead(200, {
      'Content-Type': file.mime,
      'Content-Length': String(file.size),
      'Cache-Control': 'no-store',
    });
    file.stream.pipe(res);
    return;
  }

  json(res, 404, { ok: false, error: '未知端点' });
}
