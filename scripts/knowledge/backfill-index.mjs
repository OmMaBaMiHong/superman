import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const BATCH_SIZE = 5;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });

  // 动态导入 TypeScript 模块（通过 tsx 支持 @/ 路径别名）
  let indexArticle;
  try {
    const mod = await import(
      path.join(repoRoot, 'src/server/integrations/knowledge/indexingService.ts')
    );
    indexArticle = mod.indexArticle;
  } catch (err) {
    console.error('Failed to load indexingService:', err);
    console.error(
      'Make sure you run this script with tsx: npx tsx scripts/knowledge/backfill-index.mjs',
    );
    await pool.end();
    process.exit(1);
  }

  // 1. 统计总文章数
  const { rows: countRows } = await pool.query(
    'select count(*)::int as total from articles',
  );
  const totalArticles = countRows[0].total;
  console.log(`Total articles in database: ${totalArticles}`);

  // 2. 统计已索引文章数
  const { rows: indexedCountRows } = await pool.query(
    'select count(distinct article_id)::int as cnt from knowledge_embeddings',
  );
  const alreadyIndexed = indexedCountRows[0].cnt;
  console.log(`Already indexed articles: ${alreadyIndexed}`);

  // 3. 查询所有未索引的文章
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
      batch.map((article) =>
        indexArticle(Number(article.id), article.title, article.content_html ?? ''),
      ),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const article = batch[j];
      const seq = i + j + 1;

      if (result.status === 'fulfilled') {
        successCount++;
        console.log(`[${seq}/${toIndex}] Indexed article ${article.id} - "${article.title?.slice(0, 60)}"`);
      } else {
        failCount++;
        console.error(`[${seq}/${toIndex}] Failed to index article ${article.id}:`, result.reason);
      }
    }

    // 打印批次进度
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const progress = (((i + batch.length) / toIndex) * 100).toFixed(1);
    console.log(`  Progress: ${i + batch.length}/${toIndex} (${progress}%) | Elapsed: ${elapsed}s`);
  }

  // 5. 打印统计信息
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Indexing Complete ===');
  console.log(`  Total processed: ${toIndex}`);
  console.log(`  Successful:      ${successCount}`);
  console.log(`  Failed:          ${failCount}`);
  console.log(`  Elapsed time:    ${totalElapsed}s`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});