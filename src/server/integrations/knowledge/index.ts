/**
 * 知识库 server 适配壳（P2f-A2）：实现已迁至 core/knowledge（宿主无关）。
 * 这里保留 Next.js 侧旧签名（getPool + 从 settings 解析 AI 配置），
 * Next.js 路由与 articlesRepo 的调用点零改动；插件宿主直接用 core。
 */
import { getPool } from '@/server/infra/db/pool';
import { getAppSettings, getAiApiKey } from '@/server/domains/settings/repositories/settingsRepo';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';
import {
  chunkArticle,
  generateEmbedding as coreGenerateEmbedding,
  generateEmbeddings as coreGenerateEmbeddings,
  indexArticle as coreIndexArticle,
  deleteArticleIndex as coreDeleteArticleIndex,
  hybridSearch as coreHybridSearch,
  type KnowledgeAiConfig,
  type SearchResult,
} from '@/core/knowledge/index';

export { chunkArticle };

export type KnowledgeSearchResult = SearchResult;

async function resolveConfig(): Promise<KnowledgeAiConfig> {
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

/** 索引单篇文章（articlesRepo 落库钩子用；失败由调用方 catch，不阻塞落库）。 */
export async function indexArticle(
  articleId: number,
  title: string,
  content: string,
): Promise<void> {
  await coreIndexArticle(getPool(), { articleId, title, content }, { config: await resolveConfig() });
}

export async function deleteArticleIndex(articleId: number): Promise<void> {
  await coreDeleteArticleIndex(getPool(), articleId);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return coreGenerateEmbedding(text, { config: await resolveConfig() });
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return coreGenerateEmbeddings(texts, { config: await resolveConfig() });
}

/**
 * 混合检索。AI 未配置或向量化失败时降级纯全文（core 内保证不抛错）。
 */
export async function hybridSearch(question: string, limit: number = 10): Promise<KnowledgeSearchResult[]> {
  const pool = getPool();
  let config: KnowledgeAiConfig | null = null;
  try {
    config = await resolveConfig();
  } catch {
    config = null;
  }
  return coreHybridSearch(pool, question, limit, {
    embeddingFn: config
      ? (q) => coreGenerateEmbedding(q, { config: config as KnowledgeAiConfig })
      : () => Promise.reject(new Error('未配置 AI')),
  });
}
