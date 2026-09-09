import crypto from 'node:crypto';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { resolveSharedAiConfig } from './runtimeConfig';

export interface AiConfigFingerprints {
  shared: string;
  translation: string;
}

export interface AiCleanupScopes {
  summary: boolean;
  translation: boolean;
  digest: boolean;
}

export interface ResolveAiConfigFingerprintsInput {
  settings: unknown;
  aiApiKey: string;
  translationApiKey?: string | null;
}

export interface ResolveAiCleanupScopesInput {
  previous: ResolveAiConfigFingerprintsInput;
  next: ResolveAiConfigFingerprintsInput;
}

export const AI_CONFIG_CHANGED_ERROR_CODE = 'ai_config_changed';
export const AI_CONFIG_CHANGED_ERROR_MESSAGE = 'AI 配置已更新，已取消旧任务';
export const AI_CONFIG_CHANGED_RAW_ERROR = 'AI configuration changed';

function trim(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fingerprint(value: Record<string, unknown>): string {
  return sha256(JSON.stringify(value));
}

export function resolveAiConfigFingerprints(
  input: ResolveAiConfigFingerprintsInput,
): AiConfigFingerprints {
  const settings = normalizePersistedSettings(input.settings);
  const sharedConfig = {
    ...resolveSharedAiConfig({ settings, aiApiKey: input.aiApiKey }),
    summaryPrompt: trim(settings.ai.summaryPrompt),
  };

  const translationConfig = settings.ai.translation.useSharedAi
    ? {
        useSharedAi: true,
        ...sharedConfig,
      }
    : {
        useSharedAi: false,
        model: trim(settings.ai.translation.model),
        apiBaseUrl: trim(settings.ai.translation.apiBaseUrl),
        apiKey: trim(input.translationApiKey),
        // 专用翻译配置同样会消费深度思考开关，指纹必须覆盖它才能正确触发 cleanup。
        deepThinkingEnabled: Boolean(settings.ai.deepThinkingEnabled),
      };

  const translationConfigWithPrompt = {
    ...translationConfig,
    translationPrompt: trim(settings.ai.translationPrompt),
  };

  return {
    shared: fingerprint(sharedConfig),
    translation: fingerprint(translationConfigWithPrompt),
  };
}

export function resolveAiCleanupScopes(
  previous: AiConfigFingerprints,
  next: AiConfigFingerprints,
): AiCleanupScopes {
  const sharedChanged = previous.shared !== next.shared;
  const translationChanged = previous.translation !== next.translation;

  return {
    summary: sharedChanged,
    translation: translationChanged,
    digest: sharedChanged,
  };
}

export function resolveAiCleanupScopesForInputs(
  input: ResolveAiCleanupScopesInput,
): AiCleanupScopes {
  return resolveAiCleanupScopes(
    resolveAiConfigFingerprints(input.previous),
    resolveAiConfigFingerprints(input.next),
  );
}

export function hasAiCleanupScopes(scopes: AiCleanupScopes): boolean {
  return scopes.summary || scopes.translation || scopes.digest;
}

function normalizeFingerprint(value: string | null | undefined): string | null {
  const trimmed = trim(value);
  return trimmed || null;
}

export class AiConfigChangedError extends Error {
  constructor() {
    super(AI_CONFIG_CHANGED_RAW_ERROR);
    this.name = 'AiConfigChangedError';
  }
}

export function createConfigFingerprintGuard(input: {
  initialFingerprint?: string | null;
  loadCurrentFingerprint: () => Promise<string>;
}): () => Promise<void> {
  let expectedFingerprint = normalizeFingerprint(input.initialFingerprint);

  return async () => {
    const currentFingerprint = await input.loadCurrentFingerprint();

    if (!expectedFingerprint) {
      expectedFingerprint = currentFingerprint;
      return;
    }

    if (currentFingerprint !== expectedFingerprint) {
      throw new AiConfigChangedError();
    }
  };
}
