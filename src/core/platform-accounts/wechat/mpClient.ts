/**
 * 公众号（微信 mp）客户端。
 *
 * 链路：appid+secret → gettoken（缓存，7200s 预留 200s 余量）→ draft/add 建草稿。
 * 只做到草稿箱：2025-07 起个人主体自动发布接口已回收（调研报告 §C1），
 * 群发/发布明确不做。
 *
 * 安全纪律：appid/secret 只在请求构造内存在；
 * 错误消息 / 日志一律不含 URL（query 带 secret），只含 errcode/errmsg。
 */
export interface WechatMpCredential {
  appid: string;
  secret: string;
}

export interface WechatMpDraftArticle {
  title: string;
  /** 正文 HTML（公众号编辑器语义）。 */
  content: string;
  author?: string;
  /** 摘要（不填微信自动截正文）。 */
  digest?: string;
  contentSourceUrl?: string;
}

export interface WechatMpErrorShape {
  code: 'token_failed' | 'api_error' | 'network_error';
  message: string;
  errcode?: number;
}

export class WechatMpError extends Error {
  readonly code: WechatMpErrorShape['code'];
  readonly errcode?: number;

  constructor(shape: WechatMpErrorShape) {
    super(shape.message);
    this.name = 'WechatMpError';
    this.code = shape.code;
    this.errcode = shape.errcode;
  }
}

/** 测试注入点：替换底层 HTTP。 */
export type MpJsonFetcher = (input: {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
}) => Promise<{ status: number; json: Record<string, unknown> | null }>;

const MP_API_HOST = 'https://api.weixin.qq.com';
const TOKEN_BUFFER_SECONDS = 200;

async function defaultMpFetch(input: {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
}): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(input.url, {
    method: input.method,
    headers: input.body ? { 'content-type': 'application/json' } : undefined,
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export function createWechatMpClient(fetchJson: MpJsonFetcher = defaultMpFetch) {
  const tokenCache = new Map<string, CachedToken>();

  async function getAccessToken(credential: WechatMpCredential): Promise<string> {
    const cached = tokenCache.get(credential.appid);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.accessToken;
    }

    const url =
      `${MP_API_HOST}/cgi-bin/token?grant_type=client_credential` +
      `&appid=${encodeURIComponent(credential.appid)}` +
      `&secret=${encodeURIComponent(credential.secret)}`;
    let result: { status: number; json: Record<string, unknown> | null };
    try {
      result = await fetchJson({ url, method: 'GET' });
    } catch (err) {
      throw new WechatMpError({
        code: 'network_error',
        message: `公众号 token 请求网络失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const json = result.json;
    const accessToken = typeof json?.access_token === 'string' ? json.access_token : null;
    if (!accessToken) {
      const errcode = typeof json?.errcode === 'number' ? json.errcode : undefined;
      const errmsg = typeof json?.errmsg === 'string' ? json.errmsg : `HTTP ${result.status}`;
      throw new WechatMpError({
        code: 'token_failed',
        message: `公众号凭证校验失败：${errmsg}`,
        errcode,
      });
    }

    const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : 7200;
    tokenCache.set(credential.appid, {
      accessToken,
      expiresAtMs: Date.now() + Math.max(0, expiresIn - TOKEN_BUFFER_SECONDS) * 1000,
    });
    return accessToken;
  }

  /** 新建草稿，返回 media_id。 */
  async function addDraft(
    credential: WechatMpCredential,
    article: WechatMpDraftArticle,
  ): Promise<string> {
    const token = await getAccessToken(credential);
    const result = await fetchJson({
      url: `${MP_API_HOST}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`,
      method: 'POST',
      body: {
        articles: [
          {
            article_type: 'news',
            title: article.title,
            author: article.author ?? '',
            digest: article.digest ?? '',
            content: article.content,
            content_source_url: article.contentSourceUrl ?? '',
            need_open_comment: 0,
            only_fans_can_comment: 0,
          },
        ],
      },
    });

    const json = result.json;
    const mediaId = typeof json?.media_id === 'string' ? json.media_id : null;
    if (!mediaId) {
      const errcode = typeof json?.errcode === 'number' ? json.errcode : undefined;
      const errmsg = typeof json?.errmsg === 'string' ? json.errmsg : `HTTP ${result.status}`;
      throw new WechatMpError({
        code: 'api_error',
        message: `公众号草稿创建失败：${errmsg}`,
        errcode,
      });
    }
    return mediaId;
  }

  /** verify 用：能拿到 token 即凭证有效。 */
  async function verifyCredential(credential: WechatMpCredential): Promise<void> {
    tokenCache.delete(credential.appid);
    await getAccessToken(credential);
  }

  return { getAccessToken, addDraft, verifyCredential };
}

export type WechatMpClient = ReturnType<typeof createWechatMpClient>;
