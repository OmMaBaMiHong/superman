/**
 * 向量化（P2f-A 抽进 core）：OpenAI 兼容 embeddings，模型 text-embedding-3-small
 * （1536 维，与迁移 0041 的 vector(1536) 对齐）。config 由调用方注入（宿主无关），
 * client 可注入用于测试。
 */
import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';

export interface KnowledgeAiConfig {
  apiKey: string;
  apiBaseUrl: string;
  model?: string;
}

type OpenAILike = { embeddings: { create(input: { model: string; input: string[] }): Promise<{ data: Array<{ index: number; embedding: number[] }> }> } };
type CreateClient = (opts: { apiKey: string; baseURL: string }) => OpenAILike;

export interface EmbeddingDeps {
  config: KnowledgeAiConfig;
  createClient?: CreateClient;
}

function defaultCreateClient(opts: { apiKey: string; baseURL: string }): OpenAILike {
  return new OpenAI(opts) as unknown as OpenAILike;
}

async function buildClient(deps: EmbeddingDeps): Promise<OpenAILike> {
  const createClient = deps.createClient ?? (defaultCreateClient as CreateClient);
  return createClient({ apiKey: deps.config.apiKey, baseURL: deps.config.apiBaseUrl });
}

/** 批量生成 embedding，按输入顺序返回。 */
export async function generateEmbeddings(texts: string[], deps: EmbeddingDeps): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = await buildClient(deps);
  const resp = await client.embeddings.create({
    model: deps.config.model || EMBEDDING_MODEL,
    input: texts,
  });
  return resp.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** 单文本向量化。 */
export async function generateEmbedding(text: string, deps: EmbeddingDeps): Promise<number[]> {
  return (await generateEmbeddings([text], deps))[0];
}
