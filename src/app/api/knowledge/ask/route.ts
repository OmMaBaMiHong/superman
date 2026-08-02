import { NextRequest } from 'next/server';
import { getPool } from '@/server/infra/db/pool';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { getAppSettings, getAiApiKey } from '@/server/domains/settings/repositories/settingsRepo';
import { hybridSearch } from '@/server/integrations/knowledge/searchService';
import { createOpenAIClient } from '@/server/integrations/ai/openaiClient';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';
import { getArticleById } from '@/server/domains/articles/repositories/articlesRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPTS: Record<string, string> = {
  personal_assistant: `你是 FeedFuse 智能助手，基于用户订阅的 RSS 文章知识库回答问题。
请根据提供的上下文信息，给出准确、简洁的回答。如果上下文不足以回答问题，请明确说明。
引用来源时请标注文章标题。回答使用 Markdown 格式。`,
  content_creation: `你是 FeedFuse 内容创作助手，帮助用户从订阅源中快速检索素材、引用和灵感。
请根据提供的上下文，提炼关键信息、数据、观点，并以结构化方式呈现。
提供可引用的原文片段，标注来源文章标题。`,
  information_filtering: `你是 FeedFuse 信息筛选助手，帮助用户从大量订阅内容中提炼精华。
请根据问题，从提供的上下文中筛选最相关的信息，生成摘要式的回答。
按主题归类，突出重点，帮助用户减少信息过载。`,
};

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session && 'response' in session) return session.response;
  const userId = session.userId;

  try {
    const { question, mode = 'personal_assistant', articleId } = await request.json();
    if (!question || typeof question !== 'string') {
      return Response.json(
        { ok: false, error: { code: 'invalid_input', message: '请输入问题' } },
        { status: 400 },
      );
    }

    const pool = getPool();

    // 1. 构建上下文：指定 articleId 时直接读取文章全文，否则走混合检索
    let context: string;
    let sources: { title: string; articleId: number }[];

    if (articleId && typeof articleId === 'number') {
      const article = await getArticleById(pool, String(articleId), userId);
      if (!article) {
        return Response.json(
          { ok: false, error: { code: 'not_found', message: '文章不存在' } },
          { status: 404 },
        );
      }
      const content =
        article.contentFullHtml || article.contentHtml || article.summary || '';
      context = `[来源: ${article.title}]\n${content}`;
      sources = [{ title: article.title, articleId: Number(article.id) }];
    } else {
      const searchResults = await hybridSearch(question, 8);
      context = searchResults
        .map((r) => `[来源: ${r.title}]\n${r.chunkText}`)
        .join('\n\n---\n\n');
      sources = searchResults.map((r) => ({
        title: r.title,
        articleId: r.articleId,
      }));
    }

    // 2. 流式 LLM 回答
    const [appSettings, aiApiKey] = await Promise.all([
      getAppSettings(pool),
      getAiApiKey(pool),
    ]);
    const config = resolveSharedAiConfig({
      settings: { ai: { model: appSettings.aiModel, apiBaseUrl: appSettings.aiApiBaseUrl } },
      aiApiKey,
    });

    const client = createOpenAIClient({
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      source: 'knowledge',
      requestLabel: 'knowledge_ask',
    });

    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.personal_assistant;

    const stream = await client.chat.completions.create({
      model: config.model,
      stream: true,
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\n\n当前时间: ${new Date().toISOString()}`,
        },
        {
          role: 'user',
          content: `基于以下知识库内容回答问题：\n\n${context}\n\n---\n\n问题：${question}`,
        },
      ],
    });

    // 4. 返回 SSE 流
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`),
              );
            }
          }
          // 发送来源信息
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true, sources })}\n\n`),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: '回答生成失败' })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: 'internal_error', message: '服务暂时不可用' } },
      { status: 500 },
    );
  }
}