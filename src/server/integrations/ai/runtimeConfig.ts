import { DEFAULT_FREE_MODEL, FREE_MODEL_BASE_URL, isFreeModelId } from '@/lib/ai/freeModelConfig';

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
  return {
    model: trim(input.settings.ai.model),
    apiBaseUrl: trim(input.settings.ai.apiBaseUrl),
    apiKey: trim(input.aiApiKey),
    deepThinkingEnabled: Boolean(input.settings.ai.deepThinkingEnabled),
  };
}

export function isAiRuntimeConfigComplete(config: AiRuntimeConfig): boolean {
  return Boolean(config.model && config.apiBaseUrl && config.apiKey);
}
