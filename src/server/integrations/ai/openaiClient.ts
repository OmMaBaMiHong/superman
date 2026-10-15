import OpenAI from 'openai';
import { getPool } from '@/server/infra/db/pool';
import { writeSystemLog } from '@/server/infra/logging/systemLogger';
import { FREE_MODEL_BASE_URL, isFreeModelId } from '@/lib/ai/freeModelConfig';
import { AppError } from '@/server/infra/http/errors';
import { DSH_LLM_BASE_URL, dshComplete, isDshLlmAvailable } from './dshLlmBridge';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

interface OpenAIClientLoggingInput {
  source?: string;
  requestLabel?: string;
  context?: Record<string, unknown>;
}

export function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getDockerFallbackBaseUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  const fallback = new URL(parsed.toString());
  fallback.hostname = 'host.docker.internal';
  return normalizeBaseUrl(fallback.toString());
}

function isRetryableConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') {
    return false;
  }

  const name = err.name.toLowerCase();
  const message = err.message.toLowerCase();
  return (
    name.includes('connection') ||
    message.includes('connection') ||
    message.includes('connect') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed') ||
    message.includes('network')
  );
}

function buildOpenAIClient(apiBaseUrl: string, apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: apiBaseUrl,
    dangerouslyAllowBrowser: true,
    ...(apiBaseUrl === FREE_MODEL_BASE_URL && apiKey === 'anonymous' ? { maxRetries: 0, timeout: 60_000 } : {}),
  });
}

function getCompletionModel(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('model' in payload)) {
    return null;
  }

  const model = (payload as { model?: unknown }).model;
  return typeof model === 'string' ? model : null;
}

/** 把 OpenAI 风格 content（string 或 content 数组）摊平成纯文本。 */
function flattenMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return typeof content === 'undefined' || content === null ? '' : String(content);
}

interface DshChatPayload {
  model?: string;
  messages?: Array<{ role?: unknown; content?: unknown }>;
  temperature?: number;
  max_tokens?: number;
  maxTokens?: number;
}

/**
 * DSH 宿主模型 shim：OpenAI 形状的 `chat.completions.create`，内部走 `ctx.llm.stream`。
 * 因此所有既有 AI 调用点（治理拟折 / 产品计划 / 洗稿 / 摘要）零改动即可用上 DSH 模型。
 */

/** 系统日志尽力而为写：插件宿主进程没有 DATABASE_URL（存储走 PGlite），getPool() 会同步抛——不能让日志副作用带崩模型调用。 */
async function writeDshSystemLog(entry: Parameters<typeof writeSystemLog>[1]): Promise<void> {
  try {
    await writeSystemLog(getPool(), entry)
  } catch {
    // 日志失败不影响模型调用本身
  }
}

async function createDshLlmCompletion(payload: unknown): Promise<unknown> {
  const input = (payload ?? {}) as DshChatPayload;
  const messages = Array.isArray(input.messages) ? input.messages : [];

  let system: string | undefined;
  const chat: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    const role = typeof message.role === 'string' ? message.role : 'user';
    const content = flattenMessageContent(message.content);
    if (role === 'system') {
      system = system ? `${system}\n${content}` : content;
    } else if (role === 'assistant') {
      chat.push({ role: 'assistant', content });
    } else {
      chat.push({ role: 'user', content });
    }
  }

  const startedAt = Date.now();
  try {
    const text = await dshComplete({
      ...(system ? { system } : {}),
      messages: chat,
      ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
      maxTokens: typeof input.max_tokens === 'number' ? input.max_tokens : (typeof input.maxTokens === 'number' ? input.maxTokens : 4096),
      reasoningEffort: 'off',
    });
    await writeDshSystemLog({
      level: 'info',
      category: 'external_api',
      source: 'dsh-llm',
      message: 'DSH 模型调用 completed',
      context: { model: input.model ?? null, durationMs: Date.now() - startedAt, via: 'ctx.llm' },
    });
    return { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
  } catch (err) {
    await writeDshSystemLog({
      level: 'error',
      category: 'external_api',
      source: 'dsh-llm',
      message: 'DSH 模型调用 failed',
      details: stringifyExternalError(err),
      context: { model: input.model ?? null, durationMs: Date.now() - startedAt, via: 'ctx.llm' },
    });
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function stringifyExternalError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || 'Unknown error';
  }

  if (typeof err === 'string') {
    return err;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function writeOpenAILog(input: {
  logging: Required<OpenAIClientLoggingInput>;
  apiBaseUrl: string;
  payload: unknown;
  durationMs: number;
  failed: boolean;
  details: string | null;
}) {
  await writeSystemLog(getPool(), {
    level: input.failed ? 'error' : 'info',
    category: 'external_api',
    source: input.logging.source,
    message: `${input.logging.requestLabel} ${input.failed ? 'failed' : 'completed'}`,
    details: input.failed ? input.details : null,
    context: {
      url: input.apiBaseUrl,
      method: 'POST',
      model: getCompletionModel(input.payload),
      durationMs: input.durationMs,
      ...input.logging.context,
    },
  });
}

export function createOpenAIClient(
  input: { apiBaseUrl: string; apiKey: string } & OpenAIClientLoggingInput,
) {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);

  // 走 DSH 宿主模型：返回 OpenAI 形状 shim（内部 ctx.llm.stream），零改动复用。
  if (apiBaseUrl === DSH_LLM_BASE_URL) {
    if (!isDshLlmAvailable()) {
      throw new AppError('DSH 模型服务不可用', 'dsh_llm_unavailable', 503);
    }
    const shim = {
      chat: {
        completions: {
          create: (payload: unknown) => createDshLlmCompletion(payload),
        },
      },
    };
    return shim as unknown as OpenAI;
  }

  const anonymousFree = apiBaseUrl === FREE_MODEL_BASE_URL && input.apiKey === 'anonymous';
  const fallbackApiBaseUrl = getDockerFallbackBaseUrl(apiBaseUrl);
  const client = buildOpenAIClient(apiBaseUrl, input.apiKey);
  const logging = input.source && input.requestLabel ? {
    source: input.source,
    requestLabel: input.requestLabel,
    context: input.context ?? {},
  } : null;
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = (async (payload, requestOptions) => {
    if (anonymousFree && !isFreeModelId(getCompletionModel(payload) ?? '')) {
      throw new AppError('免费模式只能使用免费模型', 'free_model_required', 400);
    }
    const startedAt = Date.now();
    let requestApiBaseUrl = apiBaseUrl;

    try {
      let result;

      try {
        result = await originalCreate(payload, requestOptions);
      } catch (err) {
        // Containers cannot reach host services via localhost, so retry loopback URLs once.
        if (!fallbackApiBaseUrl || !isRetryableConnectionError(err)) {
          throw err;
        }

        requestApiBaseUrl = fallbackApiBaseUrl;
        const fallbackClient = buildOpenAIClient(fallbackApiBaseUrl, input.apiKey);
        result = await fallbackClient.chat.completions.create(payload, requestOptions);
      }

      if (logging) {
        await writeOpenAILog({
          logging,
          apiBaseUrl: requestApiBaseUrl,
          payload,
          durationMs: Date.now() - startedAt,
          failed: false,
          details: null,
        });
      }
      return result;
    } catch (err) {
      if (logging) {
        await writeOpenAILog({
          logging,
          apiBaseUrl: requestApiBaseUrl,
          payload,
          durationMs: Date.now() - startedAt,
          failed: true,
          details: stringifyExternalError(err),
        });
      }
      if (anonymousFree) {
        const status = (err as { status?: number } | null)?.status;
        throw new AppError(status === 429 ? '免费模型已限流，请稍后重试' : '免费模型暂不可用，请重试或更换免费模型',
          status === 429 ? 'free_model_rate_limited' : 'free_model_unavailable', status === 429 ? 429 : 502);
      }
      throw err;
    }
  }) as typeof client.chat.completions.create;

  return client;
}
