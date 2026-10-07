/**
 * DSH 宿主模型桥（ctx.llm）。
 *
 * Superman 作为 DSH 插件运行，模型能力应复用 DSH 自身（`@deepseek-ai/dsh-llm`
 * 提供的 `ctx.llm` 服务 + `agentDefaultModel.currentSelection()`），而不是另设一套。
 *
 * 机制：
 *   - 插件启动时 scoped-inject `llm` / `agentDefaultModel`，调用 registerDshLlm 注册；
 *   - `resolveSharedAiConfig` 在 app_settings 未显式配置时回退到本桥；
 *   - `createOpenAIClient` 识别哨兵 baseUrl（dsh://llm）后返回一个 OpenAI 形状的
 *     shim，内部走 `ctx.llm.stream`，因此**所有既有 AI 调用点零改动**。
 *
 * 未注册（如独立 worker 进程）时 `isDshLlmAvailable()` 为 false，一切照旧。
 */

/** 哨兵 baseUrl：标识「走 DSH 宿主模型」。 */
export const DSH_LLM_BASE_URL = 'dsh://llm';

interface LlmStreamChunk {
  type: string;
  text?: string;
  reason?: { kind: string; failure?: { message?: string } };
}

interface DshLlmStreamOptions {
  provider: string;
  model: string;
  messages: Array<{ role: string; content: Array<{ type: 'text'; text: string }> }>;
  system?: string;
  temperature?: number;
  reasoningEffort?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface DshLlmService {
  stream(options: DshLlmStreamOptions): AsyncIterable<LlmStreamChunk>;
}

interface DshAgentDefaultModel {
  currentSelection?(): { provider?: string; model?: string } | undefined;
}

let llmService: DshLlmService | null = null;
let defaultModel: DshAgentDefaultModel | null = null;
let httpEndpoint: { url: string; token: string } | null = null;

/** 插件启动时注册 DSH 模型服务（scoped inject 回调里调用）。 */
export function registerDshLlm(input: { llm?: unknown; agentDefaultModel?: unknown }): void {
  llmService =
    input.llm && typeof (input.llm as DshLlmService).stream === 'function'
      ? (input.llm as DshLlmService)
      : null;
  defaultModel = (input.agentDefaultModel as DshAgentDefaultModel | undefined) ?? null;
}

/**
 * 独立进程（Next worker）通过插件内部 HTTP 复用 DSH 模型。
 * token 用两端共享的服务端密钥（auth_session_secret），无新增配置。
 */
export function configureDshLlmHttp(endpoint: { url: string; token: string }): void {
  httpEndpoint = endpoint.url && endpoint.token ? endpoint : null;
}

export function isDshLlmAvailable(): boolean {
  return llmService !== null || httpEndpoint !== null;
}

/** 解析 DSH 当前默认模型（provider + model）。 */
export function resolveDshModel(): { provider: string; model: string } {
  try {
    const selection = defaultModel?.currentSelection?.();
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model };
    }
  } catch {
    // 忽略：回退默认
  }
  return { provider: 'deepseek-official', model: 'deepseek-v4-flash' };
}

export interface DshCompleteParams {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  signal?: AbortSignal;
}

/**
 * 通过 DSH 模型服务补全文本（非流式语义：累积到结束）。
 * 仅累积 `text-delta`（不并入 reasoning，避免污染 JSON 解析）。
 */
export async function dshComplete(params: DshCompleteParams): Promise<string> {
  if (llmService) {
    return dshCompleteLocal(params);
  }
  if (httpEndpoint) {
    return dshCompleteViaHttp(params, httpEndpoint);
  }
  throw new Error('DSH 模型服务不可用');
}

/** 独立进程：POST 到插件内部端点，由插件用 ctx.llm 执行。 */
async function dshCompleteViaHttp(
  params: DshCompleteParams,
  endpoint: { url: string; token: string },
): Promise<string> {
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-superman-internal-token': endpoint.token,
    },
    body: JSON.stringify({
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages,
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      ...(typeof params.maxTokens === 'number' ? { maxTokens: params.maxTokens } : {}),
      ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`DSH 模型内部调用失败（HTTP ${response.status}）`);
  }
  const data = (await response.json()) as { ok?: boolean; text?: string; error?: string };
  if (!data.ok) {
    throw new Error(data.error ?? 'DSH 模型内部调用失败');
  }
  return data.text ?? '';
}

/** 插件进程内：直接走 ctx.llm.stream。 */
async function dshCompleteLocal(params: DshCompleteParams): Promise<string> {
  if (!llmService) throw new Error('DSH 模型服务不可用');
  const { provider, model } = resolveDshModel();

  let text = '';
  for await (const chunk of llmService.stream({
    provider,
    model,
    messages: params.messages.map((message) => ({
      role: message.role,
      content: [{ type: 'text' as const, text: message.content }],
    })),
    ...(params.system ? { system: params.system } : {}),
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    ...(typeof params.maxTokens === 'number' ? { maxTokens: params.maxTokens } : {}),
    ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
  })) {
    if (chunk.type === 'text-delta' && chunk.text) {
      text += chunk.text;
    } else if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
      throw new Error(chunk.reason.failure?.message ?? `DSH 模型调用失败（${chunk.reason.kind}）`);
    }
  }
  return text;
}
