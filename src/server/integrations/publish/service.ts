/**
 * 发布中心 —— 随附 Python 发布服务的桥接层。
 *
 * 各平台发布本质是 patchright 浏览器自动化（扫码登录 → 上传视频 → 填标题 → 点发布），
 * 由随附的 Python 服务（`vendor/douyin-publish-service`）在本地执行。本模块负责把
 * FeedFuse 后端 API 的请求转发到该 Python 服务，并规整错误返回。
 *
 * 服务地址默认 `http://127.0.0.1:5409`（sau_backend 默认端口），可用环境变量
 * `FEEDFUSE_PUBLISH_URL`（兼容旧名 `FEEDFUSE_DOUYIN_PUBLISH_URL`）覆盖。服务只应监听回环地址。
 */
import { z } from 'zod';

const publishServiceUrlSchema = z.preprocess((value) => {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  if (raw === undefined) return undefined;
  return new URL(raw);
}, z.instanceof(URL).optional());

function getServiceUrl(): URL {
  const parsed = publishServiceUrlSchema.parse(
    process.env.FEEDFUSE_PUBLISH_URL ?? process.env.FEEDFUSE_DOUYIN_PUBLISH_URL,
  );
  return parsed ?? new URL('http://127.0.0.1:5409');
}

export function getPublishServiceOrigin(): string {
  return getServiceUrl().origin;
}

/** Python 服务接口统一返回 `{ code, msg, data }` 信封，这里做规整。 */
export interface PublishServiceEnvelope {
  code: number;
  msg: string | null;
  data: unknown;
}

export async function forwardJson(
  method: 'GET' | 'POST',
  path: string,
  init?: { jsonBody?: unknown; headers?: Record<string, string>; query?: Record<string, string> },
): Promise<PublishServiceEnvelope> {
  const serviceUrl = getServiceUrl();
  const url = new URL(path, serviceUrl.origin);
  if (init?.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init?.headers ?? {}),
  };
  if (init?.jsonBody !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: init?.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const payload = (await res.json().catch(() => null)) as PublishServiceEnvelope | null;
  if (!payload || typeof payload.code !== 'number') {
    throw new Error(`发布服务返回异常（HTTP ${res.status}）`);
  }
  return payload;
}
