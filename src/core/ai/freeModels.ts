import type { Pool, PoolClient } from 'pg';
import { DEFAULT_FREE_MODEL, FREE_MODEL_BASE_URL, isFreeModelId, type FreeModelOption, type FreeModelSettings } from '@/lib/ai/freeModelConfig';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import { AppError, ValidationError } from '@/server/infra/http/errors';

type Db = Pool | PoolClient;

function unavailable(status?: number): AppError {
  return status === 429
    ? new AppError('免费模型已限流，请稍后重试', 'free_model_rate_limited', 429)
    : new AppError('免费模型服务暂不可用，请稍后重试或刷新模型列表', 'free_model_unavailable', 502);
}

async function gatewayRequest(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${FREE_MODEL_BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(response.status); }
    return await response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable();
  }
}

/** Public catalog only; pricing must explicitly confirm zero input and output cost. */
export async function listFreeModels(): Promise<FreeModelOption[]> {
  const result = await gatewayRequest('/models');
  if (!Array.isArray(result.data)) throw unavailable();
  const isZero = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number(value) === 0;
  return result.data.filter((entry: { id?: unknown; pricing?: Record<string, unknown> }) =>
    typeof entry.id === 'string' && isFreeModelId(entry.id) && entry.pricing &&
    isZero(entry.pricing.prompt) && isZero(entry.pricing.completion) && Object.values(entry.pricing).every(isZero),
  ).map((entry: { id: string; name?: string }) => ({ id: entry.id, name: entry.name || entry.id }));
}

async function requireAvailableFreeModel(model: unknown): Promise<string> {
  if (typeof model !== 'string' || !isFreeModelId(model) || !(await listFreeModels()).some((entry) => entry.id === model)) {
    throw new ValidationError('请选择当前可用的免费模型', { freeModel: '模型不在免费列表中，请刷新列表' });
  }
  return model;
}

export async function getAiModelSettings(db: Db, userId: string): Promise<FreeModelSettings> {
  const { ai } = normalizePersistedSettings(await getUiSettings(db, userId));
  return { providerMode: ai.providerMode ?? 'configured', freeModel: ai.freeModel || DEFAULT_FREE_MODEL };
}

export async function saveAiModelSettings(db: Db, userId: string, input: Record<string, unknown>): Promise<FreeModelSettings> {
  if (input.providerMode !== 'configured' && input.providerMode !== 'kilo-free') {
    throw new ValidationError('请选择模型来源', { providerMode: '无效的模型来源' });
  }
  const previous = await getAiModelSettings(db, userId);
  const freeModel = input.providerMode === 'kilo-free' ? await requireAvailableFreeModel(input.freeModel) : previous.freeModel;
  const settings = { providerMode: input.providerMode, freeModel };
  // Merge only these two fields atomically; preserve paid credentials and unrelated UI settings.
  await db.query(`insert into user_settings(user_id,ui_settings) values ($1,jsonb_build_object('ai',$2::jsonb))
    on conflict (user_id) do update set ui_settings=jsonb_set(
      coalesce(user_settings.ui_settings,'{}'::jsonb),'{ai}',
      coalesce(user_settings.ui_settings->'ai','{}'::jsonb) || $2::jsonb), updated_at=now()`, [userId, JSON.stringify(settings)]);
  return settings as FreeModelSettings;
}

export async function testFreeModel(model: unknown): Promise<{ text: string; model: string }> {
  const selected = await requireAvailableFreeModel(model);
  const result = await gatewayRequest('/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer anonymous', 'X-Title': 'Superman' },
    body: JSON.stringify({ model: selected, messages: [{ role: 'user', content: 'Reply with only OK.' }], max_tokens: 64, stream: false }),
  });
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw unavailable();
  return { text: text.trim().slice(0, 200), model: typeof result.model === 'string' ? result.model : selected };
}
