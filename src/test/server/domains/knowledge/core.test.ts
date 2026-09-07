import { describe, expect, it, vi } from 'vitest';
import { chunkArticle } from '@/core/knowledge/chunking';
import { generateEmbeddings } from '@/core/knowledge/embedding';
import { deleteArticleIndex, indexArticle } from '@/core/knowledge/indexer';
import { hybridSearch } from '@/core/knowledge/search';

describe('core/knowledge/chunking', () => {
  it('空内容返回空数组', () => {
    expect(chunkArticle('  ', '标题')).toEqual([]);
  });

  it('短内容单块且带标题前缀', () => {
    const chunks = chunkArticle('第一段内容。', '我的标题');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('[我的标题]\n第一段内容。');
    expect(chunks[0].index).toBe(0);
  });

  it('超长段落按句拆分为多块', () => {
    const long = '句子。'.repeat(600); // 1800 字 > 无；用 2000+ 触发
    const longParagraph = `${'这是一句测试句子。'.repeat(300)}`; // 3000 字
    const chunks = chunkArticle(longParagraph, '长文');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunkArticle(long, '长文').length).toBeGreaterThanOrEqual(1);
  });

  it('多段落合并进块并带标题前缀', () => {
    const chunks = chunkArticle('段落一。\n\n段落二。\n\n段落三。', '多段');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('段落一。');
    expect(chunks[0].text).toContain('段落三。');
    expect(chunks[0].text.startsWith('[多段]\n')).toBe(true);
  });
});

describe('core/knowledge/embedding', () => {
  it('空输入直接返回空数组（不建 client）', async () => {
    const embeddings = await generateEmbeddings([], {
      createClient: vi.fn() as never,
      config: { apiKey: 'k', apiBaseUrl: 'http://x', model: 'm' } as never,
    });
    expect(embeddings).toEqual([]);
  });

  it('批量向量化并按 index 排序返回', async () => {
    const create = vi.fn().mockReturnValue({
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [
            { index: 1, embedding: [4, 5, 6] },
            { index: 0, embedding: [1, 2, 3] },
          ],
        }),
      },
    });
    const embeddings = await generateEmbeddings(['a', 'b'], {
      createClient: create as never,
      config: { apiKey: 'k', apiBaseUrl: 'http://x', model: 'm' } as never,
    });
    expect(embeddings).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(create).toHaveBeenCalledWith({ apiKey: 'k', baseURL: 'http://x' });
  });
});

describe('core/knowledge/indexer', () => {
  it('indexArticle：删旧索引 → 分块 → 批量插入', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const embedFn = vi.fn().mockResolvedValue([[1, 0]]);
    await indexArticle(
      { query } as never,
      { articleId: 7, title: '标题', content: '段落一。\n\n段落二。' },
      { embeddingFn: embedFn },
    );
    expect(embedFn).toHaveBeenCalledTimes(1);
    expect(embedFn.mock.calls[0][0]).toHaveLength(1); // 两小段合并为 1 块
    expect(query).toHaveBeenCalledTimes(2);
    const deleteSql = query.mock.calls[0][0] as string;
    expect(deleteSql).toContain('delete from knowledge_embeddings where article_id = $1');
    expect(query.mock.calls[0][1]).toEqual([7]);
    const insertSql = query.mock.calls[1][0] as string;
    expect(insertSql).toContain('insert into knowledge_embeddings');
    expect(insertSql).toContain('::vector');
    expect(query.mock.calls[1][1]).toHaveLength(4); // 1 块 × 4 参数
  });

  it('分块为空时只删旧索引、不插入', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await indexArticle({ query } as never, { articleId: 7, title: 't', content: '   ' }, {});
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('deleteArticleIndex 按文章删', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await deleteArticleIndex({ query } as never, 7);
    expect(query.mock.calls[0][1]).toEqual([7]);
  });
});

describe('core/knowledge/search（RRF 混合检索 + FTS 降级）', () => {
  const vectorRows = [
    { article_id: 1, chunk_index: 0, chunk_text: '向量一', title: 'A', distance: 0.9 },
    { article_id: 2, chunk_index: 0, chunk_text: '向量二', title: 'B', distance: 0.8 },
  ];
  const ftsRows = [
    { article_id: 2, chunk_index: 0, chunk_text: '向量二', title: 'B', rank: 0.5 },
    { article_id: 3, chunk_index: 1, chunk_text: '全文三', title: 'C', rank: 0.3 },
  ];

  function makeDb() {
    return {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: vectorRows })
        .mockResolvedValueOnce({ rows: ftsRows }),
    };
  }

  it('混合检索 RRF 合并：双路都命中的排最前', async () => {
    const db = makeDb();
    const results = await hybridSearch(db as never, '问题', 5, {
      embeddingFn: vi.fn().mockResolvedValue([1, 2, 3]),
    });
    expect(results[0].articleId).toBe(2);
    expect(results.length).toBe(3);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('embedding 失败时降级 FTS-only，不抛错', async () => {
    const db = {
      query: vi.fn().mockResolvedValueOnce({ rows: ftsRows }), // 降级：只有全文一路
    };
    const results = await hybridSearch(db as never, '问题', 5, {
      embeddingFn: vi.fn().mockRejectedValue(new Error('未配置 AI')),
    });
    expect(results).toHaveLength(2);
    expect(results[0].articleId).toBe(2);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).not.toContain('<=>');
  });
});
