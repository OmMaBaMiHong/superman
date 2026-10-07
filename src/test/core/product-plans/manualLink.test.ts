import { describe, expect, it, vi } from 'vitest';
import { createManualProductPlan } from '@/core/product-plans/service';
import type { Queryable } from '@/plugin/host/db';

const PLAN_ROW = {
  id: '9',
  userId: '1',
  title: '口播助手',
  oneLiner: '一键转口播稿',
  productDesc: '',
  targetUsers: '',
  approach: '',
  businessModel: '',
  risks: '',
  competitors: '',
  pricing: '',
  milestones: '',
  validationPlan: '',
  status: 'idea',
  sourceType: 'manual',
  sourceArticleId: '892596',
  sourceUrl: 'https://v.douyin.com/FnyrvzzHWG4/',
  sourceNote: '想法',
  aiGenerated: false,
  createdAt: '2026-09-20',
  updatedAt: '2026-09-20',
};

/** 文章链接命中 + 该文章已有产品计划 → 幂等返回。 */
function dbWithLinkedPlan(): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (/from articles/i.test(sql)) return { rows: [{ id: '892596' }] };
      if (/from product_plans/i.test(sql)) return { rows: [PLAN_ROW] };
      return { rows: [] };
    }),
  } as unknown as Queryable;
}

/** 文章链接命中但还没有计划 → 应带着 source_article_id 新建（此处让新建查询返回占位行）。 */
function dbWithLinkedArticleNoPlan(): { db: Queryable; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (sql: string) => {
    if (/from articles/i.test(sql)) return { rows: [{ id: '892596' }] };
    if (/from product_plans/i.test(sql)) return { rows: [] };
    if (/insert into product_plans/i.test(sql)) {
      return { rows: [{ ...PLAN_ROW, sourceArticleId: '892596' }] };
    }
    return { rows: [] };
  });
  return { db: { query } as unknown as Queryable, query };
}

describe('product-plans/service · 人工想法自动挂真相源', () => {
  it('想法含已收录链接且已有计划 → 幂等复用，不重复建', async () => {
    const result = await createManualProductPlan(dbWithLinkedPlan(), {
      userId: '1',
      rawIdea: '婚礼上新娘问新郎一个问题，新郎的回答真的是大快人心 https://v.douyin.com/FnyrvzzHWG4/ 复制此链接',
      aiConfig: null,
    });
    expect(result.alreadyExists).toBe(true);
    expect(result.plan.id).toBe('9');
    expect(result.plan.sourceArticleId).toBe('892596');
  });

  it('想法含已收录链接但还没有计划 → 新建时带上 source_article_id 与 source_url', async () => {
    const { db, query } = dbWithLinkedArticleNoPlan();
    const result = await createManualProductPlan(db, {
      userId: '1',
      rawIdea: '把这条内容做成产品 https://v.douyin.com/FnyrvzzHWG4/',
      aiConfig: null,
    });
    expect(result.alreadyExists).toBe(false);

    const insertCall = query.mock.calls.find(([sql]) => /insert into product_plans/i.test(String(sql)));
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    // source_article_id 与 source_url 都已挂上
    expect(params).toContain('892596');
    expect(params).toContain('https://v.douyin.com/FnyrvzzHWG4/');
  });

  it('想法不含链接 → 不查文章，走普通 manual 落库', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/insert into product_plans/i.test(sql)) return { rows: [{ ...PLAN_ROW, sourceArticleId: null, sourceUrl: null }] };
      return { rows: [] };
    });
    const db = { query } as unknown as Queryable;
    await createManualProductPlan(db, { userId: '1', rawIdea: '我想做一个帮人记笔记的工具', aiConfig: null });
    const lookedUpArticle = query.mock.calls.some(([sql]) => /from articles/i.test(String(sql)));
    expect(lookedUpArticle).toBe(false);
  });
});
