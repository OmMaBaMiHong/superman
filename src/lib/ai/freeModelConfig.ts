export const FREE_MODEL_BASE_URL = 'https://api.kilo.ai/api/openrouter';
export const DEFAULT_FREE_MODEL = 'openrouter/free';

export function isFreeModelId(model: string): boolean {
  return model === DEFAULT_FREE_MODEL || model === 'kilo-auto/free' || /^[\w.-]+\/[\w./-]+:free$/.test(model);
}

export interface FreeModelSettings {
  providerMode: 'configured' | 'kilo-free';
  freeModel: string;
}

export interface FreeModelOption {
  id: string;
  name: string;
}
