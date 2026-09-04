import { Pool } from 'pg';
import OpenAI from 'openai';

const BATCH_SIZE = 5;
const CHUNK_MAX_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 50;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

function chunkArticle(content: string, title: string): Array<{ text: string; index: number }> {
  if (!content.trim()) return [];
  const paragraphs = content.split(/\n\n+/).filter(Boolean);
  const chunks: Array<{ text: string; index: number }> = [];
  let currentChunk = '';
  let currentIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (trimmed.length > CHUNK_MAX_CHARS) {
      if (currentChunk) {
        chunks.push({ text: title ? `[${title}]\n${currentChunk.trim()}` : currentChunk.trim(), index: currentIndex++ });
        currentChunk = '';
      }
      const sentences = trimmed.match(/[^。！？\n]+[。！？]?/g) ?? [trimmed];
      let sentenceBuffer = '';
      for (const sentence of sentences) {
        if ((sentenceBuffer + sentence).length > CHUNK_MAX_CHARS && sentenceBuffer) {
          chunks.push({ text: title ? `[${title}]\n${sentenceBuffer.trim()}` : sentenceBuffer.trim(), index: currentIndex++ });
          sentenceBuffer = sentenceBuffer.slice(-CHUNK_OVERLAP_CHARS) + sentence;
        } else {
          sentenceBuffer += sentence;
        }
      }
      if (sentenceBuffer) {
        chunks.push({ text: title ? `[${title}]\n${sentenceBuffer.trim()}` : sentenceBuffer.trim(), index: currentIndex++ });
      }
      continue;
    }

    const separator = currentChunk ? '\n\n' : '';
    if ((currentChunk + separator + trimmed).length > CHUNK_MAX_CHARS && currentChunk) {
      chunks.push({ text: title ? `[${title}]\n${currentChunk.trim()}` : currentChunk.trim(), index: currentIndex++ });
      currentChunk = currentChunk.slice(-CHUNK_OVERLAP_CHARS) + '\n\n' + trimmed;
    } else {
      currentChunk += separator + trimmed;
    }
  }

  if (currentChunk) {
    chunks.push({ text: title ? `[${title}]\n${currentChunk.trim()}` : currentChunk.trim(), index: currentIndex++ });
  }
  return chunks;
}

async function getAiConfig(pool: Pool): Promise<{ apiKey: string; apiBaseUrl: string; model: string }> {
  const { rows } = await pool.query('select ai_model, ai_api_base_url, ai_api_key from app_settings where id = 1');
  if (rows.length === 0) throw new Error('No app settings found');
  const row = rows[0];
  const apiKey = row.ai_api_key || '';
  const apiBaseUrl = (row.ai_api_base_url || '').replace(/\/+$/, '');
  const model = row.ai_model || 'gpt-4o';
  if (!apiKey || !apiBaseUrl) throw new Error('AI not configured - missing api key or base url');
  return { apiKey, apiBaseUrl, model };
}

async function generateEmbeddings(texts: string[], config: { apiKey: string; apiBaseUrl: string }): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.apiBaseUrl });
  const resp = await client.embeddings.create({ model: 'text-embedding-3-small', input: texts });
  return resp.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });

  // 1. 统计
  const { rows: countRows } = await pool.query('select count(*)::int as total from articles');
  const totalArticles = countRows[0].total;

  const { rows: indexedCountRows } = await pool.query(
    'select count(distinct article_id)::int as cnt from knowledge_embeddings',
  );
  const alreadyIndexed = indexedCountRows[0].cnt;
  console.log(`Total articles: ${totalArticles}, Already indexed: ${alreadyIndexed}`);

  // 2. 获取 AI 配置
  let aiConfig: { apiKey: string; apiBaseUrl: string; model: string };
  try {
    aiConfig = await getAiConfig(pool);
  } catch (err) {
    console.error('Failed to get AI config:', (err as Error).message);
    console.error('Please configure AI settings in FeedFuse first.');
    await pool.end();
    process.exit(1);
  }

  // 3. 查询未索引文章
  const { rows: articles } = await pool.query(`
    select a.id, a.title, a.content_html
    from articles a
    left join knowledge_embeddings ke on ke.article_id = a.id
    where ke.article_id is null
    order by a.id
  `);
  const toIndex = articles.length;
  console.log(`Articles to index: ${toIndex}\n`);
  if (toIndex === 0) {
    console.log('Nothing to index.');
    await pool.end();
    return;
  }

  // 4. 按批次处理
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < toIndex; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (article) => {
        const articleId = Number(article.id);
        const title = article.title || '';
        const content = article.content_html ?? '';

        // 删除旧索引
        await pool.query('delete from knowledge_embeddings where article_id = $1', [articleId]);

        // 分块
        const chunks = chunkArticle(content, title);
        if (chunks.length === 0) return;

        // 生成 embedding
        const texts = chunks.map((c) => c.text);
        const embeddings = await generateEmbeddings(texts, aiConfig);

        // 批量插入
        const values = chunks
          .map((chunk, idx) => {
            const emb = embeddings[idx];
            const escText = chunk.text.replace(/'/g, "''");
            const escEmb = JSON.stringify(emb);
            return `(${articleId}, ${chunk.index}, '${escText}', '${escEmb}'::vector)`;
          })
          .join(', ');

        await pool.query(`
          insert into knowledge_embeddings (article_id, chunk_index, chunk_text, embedding)
          values ${values}
        `);
      }),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const article = batch[j];
      const seq = i + j + 1;

      if (result.status === 'fulfilled') {
        successCount++;
        const titleShort = (article.title ?? '').slice(0, 60);
        console.log(`[${seq}/${toIndex}] Indexed article ${article.id} - "${titleShort}"`);
      } else {
        failCount++;
        console.error(`[${seq}/${toIndex}] Failed article ${article.id}:`, (result.reason as Error)?.message || result.reason);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const progress = (((i + batch.length) / toIndex) * 100).toFixed(1);
    console.log(`  Progress: ${i + batch.length}/${toIndex} (${progress}%) | Elapsed: ${elapsed}s`);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Indexing Complete ===');
  console.log(`  Processed: ${toIndex} | Success: ${successCount} | Failed: ${failCount} | Time: ${totalElapsed}s`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});