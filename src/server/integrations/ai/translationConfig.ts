import { isAiRuntimeConfigComplete, resolveSharedAiConfig, type AiRuntimeConfig, type SharedAiConfigInput } from '@/server/integrations/ai/runtimeConfig';

export interface TranslationConfigInput {
  settings: {
    ai: SharedAiConfigInput['settings']['ai'] & {
      translation: {
        useSharedAi: boolean;
        model: string;
        apiBaseUrl: string;
      };
    };
  };
  aiApiKey: string;
  translationApiKey: string;
}

export type TranslationRuntimeConfig = AiRuntimeConfig;

function trim(value: string): string {
  return value.trim();
}

export function resolveTranslationConfig(
  input: TranslationConfigInput,
): TranslationRuntimeConfig {
  const useShared = input.settings.ai.translation.useSharedAi;

  if (useShared) {
    return resolveSharedAiConfig(input);
  }

  return {
    model: trim(input.settings.ai.translation.model),
    apiBaseUrl: trim(input.settings.ai.translation.apiBaseUrl),
    apiKey: trim(input.translationApiKey),
    deepThinkingEnabled: Boolean(input.settings.ai.deepThinkingEnabled),
  };
}

export function isTranslationConfigComplete(config: TranslationRuntimeConfig): boolean {
  return isAiRuntimeConfigComplete(config);
}
