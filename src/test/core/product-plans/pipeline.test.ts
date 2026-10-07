import { describe, expect, it, vi } from 'vitest';
import { runProductPlanPipeline } from '@/core/product-plans/service';
import type { Queryable } from '@/plugin/host/db';

const enrichMock = vi.fn(async () => ({ ok: true, source: 'subtitle', textLength: 120 }));
vi.mock('@/server/services/video/enrich', () => ({
  enrichArticleWithTranscript: (...args: unknown[]) => enrichMock(...args),
}));

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '9', userId: '1', title: '口播助手', oneLiner: '一句话',
    productDesc: '已填产品描述', targetUsers: '', approach: '', businessModel: '',
    risks: '', competitors: '', pricing: '', milestones: '', validationPlan: '',
    direction: '工具', remixIdeas: '短剧分镜', pipeline: {
      source: { status: 'done' }, transcript: { status: 'done' },
      analysis: { status: 'done' }, remix: { status: 'done' },
    },
    status: 'idea', sourceType: 'manual', sourceArticleId: null, sourceUrl: null,
    sourceNote: null, aiGenerated: true, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

describe('product-plans/service · runProductPlanPipeline', () => {
  it('已完成步骤不再重跑：返回 done/skipped，不触发任何生成', async () => {
    const plan = planRow();
    const query = vi.fn(async (sql: string) => {
      if (/from product_plans/i.test(sql)) return { rows: [plan] };
      if (/update product_plans/i.test(sql)) return { rows: [plan] };
      return { rows: [] };
    });
    const db = { query } as unknown as Queryable;

    const result = await runProductPlanPipeline(db, { planId: '9', aiConfig: null });
    expect(result).not.toBeNull();
    expect(result!.pipeline.analysis).toMatchObject({ status: 'done', note: '已有规划' });
    expect(result!.pipeline.remix).toMatchObject({ status: 'done', note: '已有二创思路' });
    expect(result!.pipeline.source.status).toBe('skipped');
    // 未调用文案提取
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it('视频来源且文案待补：走文案提取，成功后 transcript=done', async () => {
    enrichMock.mockClear();
    const plan = planRow({
      productDesc: '', direction: '', remixIdeas: '',
      sourceArticleId: '892596', sourceUrl: 'https://www.douyin.com/video/123',
      pipeline: {
        source: { status: 'done' }, transcript: { status: 'pending' },
        analysis: { status: 'pending' }, remix: { status: 'pending' },
      },
    });
    const article = { id: '892596', title: '标题', summary: null, content: null, link: 'https://www.douyin.com/video/123', directionKey: null };
    const query = vi.fn(async (sql: string) => {
      if (/from articles/i.test(sql)) return { rows: [article] };
      if (/from product_plans/i.test(sql)) return { rows: [plan] };
      if (/update product_plans/i.test(sql)) return { rows: [plan] };
      return { rows: [] };
    });
    const db = { query } as unknown as Queryable;

    const result = await runProductPlanPipeline(db, { planId: '9', aiConfig: null });
    expect(result!.pipeline.transcript.status).toBe('done');
    expect(enrichMock).toHaveBeenCalledWith(db, expect.objectContaining({
      articleId: '892596', userId: '1', videoUrl: 'https://www.douyin.com/video/123', provider: 'douyin',
    }));
  });

  it('文案提取失败：transcript=failed 且带原因', async () => {
    enrichMock.mockResolvedValueOnce({ ok: false, error: 'Fresh cookies needed' } as never);
    const plan = planRow({
      sourceArticleId: '892596', sourceUrl: 'https://www.douyin.com/video/123',
      pipeline: {
        source: { status: 'done' }, transcript: { status: 'pending' },
        analysis: { status: 'done' }, remix: { status: 'done' },
      },
    });
    const article = { id: '892596', title: '标题', summary: null, content: null, link: 'https://www.douyin.com/video/123', directionKey: null };
    const query = vi.fn(async (sql: string) => {
      if (/from articles/i.test(sql)) return { rows: [article] };
      if (/from product_plans/i.test(sql)) return { rows: [plan] };
      if (/update product_plans/i.test(sql)) return { rows: [plan] };
      return { rows: [] };
    });
    const db = { query } as unknown as Queryable;

    const result = await runProductPlanPipeline(db, { planId: '9', aiConfig: null });
    expect(result!.pipeline.transcript).toMatchObject({ status: 'failed', note: 'Fresh cookies needed' });
  });
});
