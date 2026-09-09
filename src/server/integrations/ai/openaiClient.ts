import OpenAI from 'openai';
import { getPool } from '@/server/infra/db/pool';
import { writeSystemLog } from '@/server/infra/logging/systemLogger';
import { FREE_MODEL_BASE_URL, isFreeModelId } from '@/lib/ai/freeModelConfig';
import { AppError } from '@/server/infra/http/errors';

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
