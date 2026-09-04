import OpenAI from 'openai';
import { getPool } from '@/server/infra/db/pool';
import { getAppSettings, getAiApiKey } from '@/server/domains/settings/repositories/settingsRepo';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';

async function buildClient(): Promise<{ apiKey: string; apiBaseUrl: string }> {
  const pool = getPool();
  const [appSettings, aiApiKey] = await Promise.all([
    getAppSettings(pool),
    getAiApiKey(pool),
  ]);
  const config = resolveSharedAiConfig({
    settings: { ai: { model: appSettings.aiModel, apiBaseUrl: appSettings.aiApiBaseUrl } },
    aiApiKey,
  });
  return { apiKey: config.apiKey, apiBaseUrl: config.apiBaseUrl };
}

/**
 * 生成单个文本的 embedding 向量。
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const { apiKey, apiBaseUrl } = await buildClient();
  const client = new OpenAI({ apiKey, baseURL: apiBaseUrl });
  const resp = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return resp.data[0].embedding;
}

/**
 * 批量生成文本的 embedding 向量，按输入顺序返回。
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { apiKey, apiBaseUrl } = await buildClient();
  const client = new OpenAI({ apiKey, baseURL: apiBaseUrl });
  const resp = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  // 按输入顺序返回
  return resp.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}