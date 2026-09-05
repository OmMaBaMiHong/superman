import { describe, expect, it, vi } from 'vitest';
import { buildSupermanTools, registerTools } from '@/plugin/host/tools';
import { SKILL_CONTENT } from '@/plugin/host/skills';
import type { Queryable } from '@/plugin/host/db';

vi.mock('@/core/governance/repository', () => ({
  listGovernanceQueue: vi.fn(async () => ({
    items: [
      { id: '11', title: 'AI 写作新规落地，自媒体如何应对', summary: '摘要', qualityScore: 88, feedTitle: '热点雷达', governanceStatus: 'candidate', publishedAt: '2026-09-05' },
    ],
    total: 1,
  })),
  getGovernanceStats: vi.fn(async () => ({ todayPending: 2, todayArchived: 5, todayFetchSucceeded: 10, todayFetchFailed: 1, queueSize: 2 })),
  getGovernanceItemDetail: vi.fn(async (_db: unknown, input: { id: string }) =>
    input.id === '11'
      ? { id: '11', title: '标题', summary: '摘要', content: '正文'.repeat(3000), link: 'https://x', publishedAt: '2026-09-05' }
      : null),
}));

vi.mock('@/core/governance/services/governanceActionsService', () => ({
  approveGovernanceItem: vi.fn(async (_db: unknown, input: { id: string }) => ({ id: input.id, governanceStatus: 'archived' })),
  rejectGovernanceItem: vi.fn(async (_db: unknown, input: { id: string; reason: string }) => ({ id: input.id, governanceStatus: 'rejected', reason: input.reason })),
  redraftGovernanceItem: vi.fn(async () => ({ item: { id: '11', status: 'pending' }, draft: null })),
}));

vi.mock('@/core/trendradar/repository', () => ({
  listTrendRadarItemsByDate: vi.fn(async () => [
    { id: '5', platform: 'weibo', platformName: '微博', title: '热搜一', url: 'https://w', rank: 1, sourceDate: '2026-09-05' },
    { id: '6', platform: 'weibo', platformName: '微博', title: '热搜二', url: 'https://w2', rank: 2, sourceDate: '2026-09-05' },
    { id: '7', platform: 'baidu', platformName: '百度', title: '百度热一', url: 'https://b', rank: 1, sourceDate: '2026-09-05' },
  ]),
}));

vi.mock('@/core/trendradar/promote', () => ({
  promoteTrendRadarItem: vi.fn(async (_db: unknown, input: { id: string }) =>
    input.id === '5' ? { ok: true as const, articleId: '99', alreadyPromoted: false } : { ok: false as const }),
}));

vi.mock('@/core/pipelines/services/pipelineService', () => ({
  createRewriteJobs: vi.fn(async (_db: unknown, input: { articleId: string; platforms: string[] }) =>
    input.platforms.map((p, i) => ({
      job: { id: String(100 + i), articleId: input.articleId, kind: 'rewrite', platform: p, status: 'queued', createdAt: '' },
      reused: false,
      enqueued: true,
      queueJobId: 'q1',
    }))),
}));

vi.mock('@/core/pipelines/repository', () => ({
  listDrafts: vi.fn(async () => ({
    items: [{ id: '21', title: '小红书成稿', platform: 'xhs', status: 'done', similarityScore: 0.3, originalityFlag: 'rewritten', createdAt: '2026-09-05' }],
    total: 1,
  })),
  getDraftDetail: vi.fn(async (_db: unknown, id: string) =>
    id === '21'
      ? { id: '21', title: '小红书成稿', platform: 'xhs', status: 'done', similarityScore: 0.3, originalityFlag: 'needs_review', body: '正文'.repeat(2000), articleTitle: '原文', articleLink: null }
      : null),
  listPipelineJobs: vi.fn(async () => ({ items: [], total: 0 })),
}));

const fakeDb = { query: async () => ({ rows: [] }) } as Queryable;

function toolsOf(deps: Partial<Parameters<typeof buildSupermanTools>[0]> = {}) {
  const tools = buildSupermanTools({ db: fakeDb, ...deps });
  return new Map(tools.map((t) => [t.name, t]));
}

describe('plugin/host/tools · 工具表结构', () => {
  it('注册全部 13 个工具，命名纪律：新工具下划线命名', () => {
    const tools = buildSupermanTools({ db: fakeDb });
    expect(tools).toHaveLength(13);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters).toMatchObject({ type: 'object' });
      // 新工具一律下划线；superman.ping 是 K1 遗留的唯一例外
      if (tool.name !== 'superman.ping') expect(tool.name).toMatch(/^superman_[a-z_]+$/);
    }
  });

  it('registerTools 通过 ctx.inject 注册且可 dispose', () => {
    const registered: string[] = [];
    const disposers: (() => void)[] = [];
    const ctx = {
      inject(deps: string[], cb: (scope: never) => void) {
        expect(deps).toEqual(['tools']);
        cb({
          tools: {
            register(def: { name: string }) {
              registered.push(def.name);
              return () => {};
            },
          },
          effect(fn: () => () => void) {
            disposers.push(fn());
          },
        } as never);
      },
    };
    registerTools(ctx as never, { db: fakeDb });
    expect(registered).toHaveLength(13);
    expect(disposers).toHaveLength(13);
    disposers.forEach((d) => expect(() => d()).not.toThrow());
  });
});

describe('plugin/host/tools · 参数校验', () => {
  it('id 非法时返回结构化错误而不是抛异常', async () => {
    const t = toolsOf();
    for (const name of ['superman_item_approve', 'superman_item_detail', 'superman_trending_promote', 'superman_draft_read']) {
      await expect(t.get(name)!.execute({ id: 'abc' })).rejects.toThrow('正整数');
    }
  });

  it('reject/redraft 缺 reason 返回 ok:false', async () => {
    const t = toolsOf();
    expect(await t.get('superman_item_reject')!.execute({ id: '11', reason: '' })).toMatchObject({ ok: false });
    expect(await t.get('superman_item_redraft')!.execute({ id: '11' })).toMatchObject({ ok: false });
  });

  it('queue_list 非法 status 返回结构化错误；rewrite_start 非法平台被拒绝', async () => {
    const t = toolsOf();
    expect(await t.get('superman_queue_list')!.execute({ status: 'bogus' })).toMatchObject({ ok: false });
    expect(await t.get('superman_rewrite_start')!.execute({ articleId: '1', platforms: ['tiktok'] })).toMatchObject({ ok: false });
    expect(await t.get('superman_rewrite_start')!.execute({ articleId: '1', platforms: [] })).toMatchObject({ ok: false });
  });

  it('数据库未连接时抛出基础设施错误', async () => {
    const t = toolsOf({ db: null });
    await expect(t.get('superman_queue_list')!.execute({})).rejects.toThrow('数据库未连接');
  });
});

describe('plugin/host/tools · 正常路径', () => {
  it('queue_list 返回截断后的紧凑条目', async () => {
    const t = toolsOf();
    const out = await t.get('superman_queue_list')!.execute({ status: 'candidate' });
    expect(out.ok).toBe(true);
    const items = out.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ id: '11', qualityScore: 88, status: 'candidate' });
    expect(String(items[0]!.title).length).toBeLessThanOrEqual(80);
  });

  it('approve 走 core 服务层并返回新状态', async () => {
    const t = toolsOf();
    const out = await t.get('superman_item_approve')!.execute({ id: '11' });
    expect(out).toMatchObject({ ok: true, item: { id: '11', status: 'archived' } });
  });

  it('item_detail 正文截断到约 2000 字', async () => {
    const t = toolsOf();
    const out = await t.get('superman_item_detail')!.execute({ id: '11' });
    const item = (out.item as { content: string });
    expect(item.content.length).toBeLessThan(2200);
    expect(item.content).toContain('截断');
  });

  it('trending_today 按平台分组且 top 可控；promote 幂等字段透传', async () => {
    const t = toolsOf();
    const out = await t.get('superman_trending_today')!.execute({ top: 1 });
    const platforms = out.platforms as { platform: string; items: unknown[] }[];
    expect(platforms.find((p) => p.platform === 'weibo')!.items).toHaveLength(1);
    const promoted = await t.get('superman_trending_promote')!.execute({ id: '5' });
    expect(promoted).toMatchObject({ ok: true, articleId: '99', alreadyPromoted: false });
  });

  it('draft_read 对 needs_review 原样透传标记（由技能约束 agent 提醒）', async () => {
    const t = toolsOf();
    const out = await t.get('superman_draft_read')!.execute({ id: '21' });
    expect((out.draft as { originalityFlag: string }).originalityFlag).toBe('needs_review');
  });

  it('fetch_trigger 走手动入口且不改开关', async () => {
    const fetchTrigger = vi.fn(async () => ({ feeds: 3, inserted: 2 }));
    const t = toolsOf({ fetchTrigger });
    const out = await t.get('superman_fetch_trigger')!.execute({});
    expect(fetchTrigger).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ ok: true, feeds: 3, inserted: 2 });
    expect(String(out.mutexNote)).toContain('互斥');
  });

  it('stats 返回今日概览', async () => {
    const t = toolsOf();
    const out = await t.get('superman_stats')!.execute({});
    expect(out).toMatchObject({ ok: true, todayPending: 2, queueSize: 2 });
  });
});

describe('plugin/host/skills · 操作手册', () => {
  it('技能正文包含状态机、红线与全部工具名', () => {
    expect(SKILL_CONTENT).toContain('candidate');
    expect(SKILL_CONTENT).toContain('needs_review');
    expect(SKILL_CONTENT).toContain('不批量准奏');
    expect(SKILL_CONTENT).toContain('确认');
    const tools = buildSupermanTools({ db: fakeDb });
    for (const tool of tools) {
      expect(SKILL_CONTENT).toContain(tool.name);
    }
  });
});
