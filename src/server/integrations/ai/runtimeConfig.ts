import { DEFAULT_FREE_MODEL, FREE_MODEL_BASE_URL, isFreeModelId } from '@/lib/ai/freeModelConfig';
import { DSH_LLM_BASE_URL, isDshLlmAvailable, resolveDshModel } from './dshLlmBridge';

export interface AiRuntimeConfig {
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  deepThinkingEnabled: boolean;
}

export interface SharedAiConfigInput {
  settings: {
    ai: {
      providerMode?: 'configured' | 'kilo-free';
      freeModel?: string;
      model: string;
      apiBaseUrl: string;
      deepThinkingEnabled?: boolean;
    };
  };
  aiApiKey: string;
}

function trim(value: string): string {
  return value.trim();
}

export function resolveSharedAiConfig(input: SharedAiConfigInput): AiRuntimeConfig {
  if (input.settings.ai.providerMode === 'kilo-free') {
    const model = input.settings.ai.freeModel?.trim() || DEFAULT_FREE_MODEL;
    if (!isFreeModelId(model)) throw new Error('免费模式只能使用免费模型');
    return { model, apiBaseUrl: FREE_MODEL_BASE_URL, apiKey: 'anonymous', deepThinkingEnabled: false };
  }

  const model = trim(input.settings.ai.model);
  const apiBaseUrl = trim(input.settings.ai.apiBaseUrl);
  const apiKey = trim(input.aiApiKey);

  // 应用内显式配置齐全 → 直接用。
  if (model && apiBaseUrl && apiKey) {
    return { model, apiBaseUrl, apiKey, deepThinkingEnabled: Boolean(input.settings.ai.deepThinkingEnabled) };
  }

  // 未显式配置 → 复用 DSH 宿主模型（插件零重复配置）。
  if (isDshLlmAvailable()) {
    return {
      model: model || resolveDshModel().model,
      apiBaseUrl: DSH_LLM_BASE_URL,
      apiKey: 'dsh-host',
      deepThinkingEnabled: Boolean(input.settings.ai.deepThinkingEnabled),
    };
  }

  return { model, apiBaseUrl, apiKey, deepThinkingEnabled: Boolean(input.settings.ai.deepThinkingEnabled) };
}

export function isAiRuntimeConfigComplete(config: AiRuntimeConfig): boolean {
  return Boolean(config.model && config.apiBaseUrl && config.apiKey);
}
