import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAuth, SESSION_COOKIE } from '@/plugin/host/auth';
import { createApiHandler } from '@/plugin/host/routes';

const hybridSearchMock = vi.fn();
const getUiSettingsMock = vi.fn(async () => ({}));
const getAiApiKeyMock = vi.fn(async () => 'sk-test');
const getAppSettingsMock = vi.fn(async () => ({ aiModel: 'test-model', aiApiBaseUrl: 'http://ai' }));
const getArticleByIdMock = vi.fn();
const completionsCreateMock = vi.fn();

vi.mock('@/core/knowledge/search', () => ({
  hybridSearch: (...a: unknown[]) => hybridSearchMock(...a),
}));
vi.mock('@/core/knowledge/embedding', () => ({
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
}));
vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: (...a: unknown[]) => getUiSettingsMock(...a),
  getAiApiKey: (...a: unknown[]) => getAiApiKeyMock(...a),
  getAppSettings: (...a: unknown[]) => getAppSettingsMock(...a),
}));
vi.mock('@/server/domains/articles/repositories/articlesRepo', () => ({
  getArticleById: (...a: unknown[]) => getArticleByIdMock(...a),
  insertArticleIgnoreDuplicate: vi.fn(),
}));
vi.mock('@/server/integrations/ai/openaiClient', () => ({
  createOpenAIClient: () => ({
    chat: { completions: { create: completionsCreateMock } },
  }),
}));

interface MockRes {
  status: number | null;
  headers: Record<string, string>;
  body: string;
}

function makeRes() {
  const res: MockRes = { status: null, headers: {}, body: '' };
  return Object.assign(res, {
    writeHead(status: number, headers?: Record<string, string>) {
      res.status = status;
      if (headers) Object.assign(res.headers, headers);
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    write(chunk: string | Buffer) {
      res.body += chunk.toString();
    },
    end(body?: string | Buffer) {
      if (body) res.body += body.toString();
    },
  });
}

function makeReq(method: string, url: string, cookie?: string, payload?: unknown) {
  if (method === 'POST' || method === 'PUT') {
    const req = Readable.from([Buffer.from(JSON.stringify(payload ?? {}))]) as Readable & {
      method: string; url: string; headers: Record<string, string>;
    };
    req.method = method;
    req.url = url;
    req.headers = cookie ? { cookie } : {};
    return req as never;
  }
  const req = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> };
  req.method = method;
  req.url = url;
  req.headers = cookie ? { cookie } : {};
  return req as never;
}

const fakeDb = { query: async () => ({ rows: [] }) };

function makeHandler() {
  const auth = createAuth({ db: null, secret: '' });
  const handler = createApiHandler({ auth, db: fakeDb, staticRoot: '/nonexistent' });
  return { auth, handler };
}

async function login(auth: ReturnType<typeof createAuth>): Promise<string> {
  const session = (await auth.login('admin', 'superman-dev'))!;
  const res = makeRes();
  auth.issueCookie(res as never, session);
  return `${SESSION_COOKIE}=${/superman_session=([^;]+)/.exec(res.headers['set-cookie'])![1]}`;
}

describe('plugin/host/api · knowledge（P2f-A3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiApiKeyMock.mockResolvedValue('sk-test');
  });

  it('GET /knowledge/search：返回检索结果信封', async () => {
    hybridSearchMock.mockResolvedValue([
      { articleId: 1, chunkIndex: 0, chunkText: '文本', title: '文章A', score: 0.5 },
    ]);
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('GET', '/s/api/knowledge/search?q=%E9%97%AE%E9%A2%98', cookie), res as never);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.items).toHaveLength(1);
    expect(hybridSearchMock).toHaveBeenCalledTimes(1);
  });

  it('POST /knowledge/ask：SSE 增量 + done + sources + [DONE]', async () => {
    hybridSearchMock.mockResolvedValue([
      { articleId: 1, chunkIndex: 0, chunkText: '上下文', title: '文章A', score: 0.5 },
    ]);
    completionsCreateMock.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: '回答' } }] };
      yield { choices: [{ delta: { content: '完毕' } }] };
    })());
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(
      makeReq('POST', '/s/api/knowledge/ask', cookie, { question: '最近有什么新闻？' }),
      res as never,
    );
    expect(hybridSearchMock).toHaveBeenCalledTimes(1);
    expect(res.body).toContain('"content":"回答"');
    expect(res.body).toContain('"content":"完毕"');
    expect(res.body).toContain('"done":true');
    expect(res.body).toContain('"sources"');
    expect(res.body).toContain('data: [DONE]');
  });

  it('POST /knowledge/ask：空 question 返回 400', async () => {
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(makeReq('POST', '/s/api/knowledge/ask', cookie, { question: '' }), res as never);
    expect(res.status).toBe(400);
  });

  it('POST /knowledge/ask：未配置 AI 返回 400（fail fast）', async () => {
    getAiApiKeyMock.mockResolvedValue('');
    const { auth, handler } = makeHandler();
    const cookie = await login(auth);
    const res = makeRes();
    await handler(
      makeReq('POST', '/s/api/knowledge/ask', cookie, { question: '问题' }),
      res as never,
    );
    expect(res.status).toBe(400);
  });
});
