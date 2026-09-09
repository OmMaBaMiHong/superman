import { describe, expect, it } from 'vitest';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';
import { resolveTranslationConfig } from '@/server/integrations/ai/translationConfig';
import { resolveAiConfigFingerprints } from '@/server/integrations/ai/configFingerprints';

const saved = { model: 'paid-model', apiBaseUrl: 'https://existing.example/v1', providerMode: 'kilo-free', freeModel: 'openrouter/free' };

describe('free model runtime selection', () => {
  it('uses the public anonymous gateway without forwarding the saved private key', () => {
    const settings = normalizePersistedSettings({ ai: saved });
    expect(resolveSharedAiConfig({ settings, aiApiKey: 'private-existing-key' })).toEqual({
      model: 'openrouter/free', apiBaseUrl: 'https://api.kilo.ai/api/openrouter', apiKey: 'anonymous', deepThinkingEnabled: false,
    });
    expect(settings.ai).toMatchObject(saved);
  });
  it('restores the configured provider when free mode is off', () => {
    const settings = normalizePersistedSettings({ ai: { ...saved, providerMode: 'configured' } });
    expect(resolveSharedAiConfig({ settings, aiApiKey: 'original' })).toMatchObject({ model: 'paid-model', apiKey: 'original' });
  });
  it('rejects a paid model in free mode even if persisted settings were tampered with', () => {
    const settings = normalizePersistedSettings({ ai: { ...saved, freeModel: 'paid-model' } });
    expect(() => resolveSharedAiConfig({ settings, aiApiKey: 'original' })).toThrow(/免费/);
  });
  it('uses the free provider for shared translation and includes it in config fingerprints', () => {
    const settings = normalizePersistedSettings({ ai: saved });
    expect(resolveTranslationConfig({ settings, aiApiKey: 'original', translationApiKey: '' }).apiKey).toBe('anonymous');
    const previous = resolveAiConfigFingerprints({ settings: { ai: { ...saved, providerMode: 'configured' } }, aiApiKey: 'original' });
    const next = resolveAiConfigFingerprints({ settings, aiApiKey: 'original' });
    expect(next.shared).not.toBe(previous.shared);
    expect(next.translation).not.toBe(previous.translation);
  });
});
