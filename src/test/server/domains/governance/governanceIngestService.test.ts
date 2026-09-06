import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { evaluateGovernanceBatch } from '@/core/governance/services/governanceIngestService';
import type { GovernanceDraft } from '@/core/governance/aiDraft';

const getGovernancePreferenceMock = vi.fn();
const listExistingArticleLinksMock = vi.fn();
const listRecentRejectMemoryMock = vi.fn();
const listRecentArticleTitlesMock = vi.fn();
const countTodayGovernedByCategoryMock = vi.fn();

vi.mock('@/core/governance/repository', () => ({
  getGovernancePreference: (...args: unknown[]) => getGovernancePreferenceMock(...args),
  listExistingArticleLinks: (...args: unknown[]) => listExistingArticleLinksMock(...args),
  listRecentRejectMemory: (...args: unknown[]) => listRecentRejectMemoryMock(...args),
  listRecentArticleTitles: (...args: unknown[]) => listRecentArticleTitlesMock(...args),
  countTodayGovernedByCategory: (...args: unknown[]) => countTodayGovernedByCategoryMock(...args),
}));

const listDirectionStrategiesMock = vi.fn();
vi.mock('@/core/governance/directions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/governance/directions')>();
  return {
    ...original,
    listDirectionStrategies: (...args: unknown[]) => listDirectionStrategiesMock(...args),
  };
});

const pool = {} as Pool;

function makeDraft(score: number, overrides: Partial<GovernanceDraft> = {}): GovernanceDraft {
  return {
    title: '拟折标题',
    summary: '拟折摘要',
    aiReason: '拟折理由',
    qualityScore: score,
    usedFallback: false,
    directionKey: null,
    directionReason: null,
    directionConfidence: null,
    ...overrides,
  };
}

function makeItem(index: number, overrides: Record<string, unknown> = {}) {
  // 每个 index 用互不重叠的汉字区间造标题，避免批次内标题相似度误判。
  const distinctTitle = Array.from(
    { length: 12 },
    (_, i) => String.fromCharCode(0x6000 + index * 16 + i),
  ).join('');
  return {
    dedupeKey: `k${index}`,
    title: distinctTitle,
    link: `https://example.com/a${index}`,
    summary: null,
    contentText: '正文内容',
    ...overrides,
  } as const;
}

describe('governanceIngestService / evaluateGovernanceBatch', () => {
  beforeEach(() => {
    getGovernancePreferenceMock.mockReset().mockResolvedValue(null);
    listExistingArticleLinksMock.mockReset().mockResolvedValue([]);
    listRecentRejectMemoryMock.mockReset().mockResolvedValue([]);
    listRecentArticleTitlesMock.mockReset().mockResolvedValue([]);
    countTodayGovernedByCategoryMock.mockReset().mockResolvedValue(0);
    listDirectionStrategiesMock.mockReset().mockResolvedValue([]);
  });

  it('URL 精确去重：已有文章与 7 天驳回记忆都参与', async () => {
    listExistingArticleLinksMock.mockResolvedValue(['https://example.com/a0']);
    listRecentRejectMemoryMock.mockResolvedValue([
      { title: '别的驳回标题', sourceUrl: 'https://example.com/a1' },
    ]);
    const draft = vi.fn(async () => makeDraft(80));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [makeItem(0), makeItem(1), makeItem(2)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0]).toMatchObject({ action: 'skip', skipReason: 'duplicate_url' });
    expect(decisions[1]).toMatchObject({ action: 'skip', skipReason: 'duplicate_url' });
    expect(decisions[2]).toMatchObject({ action: 'insert', status: 'candidate' });
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it('标题相似去重：7 天驳回标题 + 本批次内互查', async () => {
    const title = '某篇被驳回的文章标题内容甲乙丙丁';
    listRecentRejectMemoryMock.mockResolvedValue([{ title, sourceUrl: null }]);
    const draft = vi.fn(async () => makeDraft(80));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        // 第一条与驳回记忆同题；第二、三条同题（批次内互查应去掉第三条）
        items: [
          makeItem(0, { title }),
          makeItem(1, { title: '批次内重复标题丙丁戊己' }),
          makeItem(2, { title: '批次内重复标题丙丁戊己', link: 'https://example.com/other' }),
        ],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0].skipReason).toBe('duplicate_title');
    expect(decisions[1].action).toBe('insert');
    expect(decisions[2]).toMatchObject({ action: 'skip', skipReason: 'duplicate_title' });
  });

  it('排除关键词命中即跳过，不消耗配额', async () => {
    getGovernancePreferenceMock.mockResolvedValue({
      id: '1',
      userId: '42',
      categoryId: '7',
      dailyLimit: 3,
      focusRatio: 60,
      autoApproveThreshold: 0,
      excludeKeywords: ['广告'],
    });
    const draft = vi.fn(async () => makeDraft(80));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [makeItem(0, { title: '这是一则广告推广' }), makeItem(1)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0]).toMatchObject({
      action: 'skip',
      skipReason: 'excluded_keyword',
      skipDetail: '广告',
    });
    expect(decisions[1].action).toBe('insert');
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it('配额：今日已占用计入，超出部分跳过且按质量分截取', async () => {
    getGovernancePreferenceMock.mockResolvedValue({
      id: '1',
      userId: '42',
      categoryId: '7',
      dailyLimit: 3,
      focusRatio: 60,
      autoApproveThreshold: 0,
      excludeKeywords: [],
    });
    countTodayGovernedByCategoryMock.mockResolvedValue(2); // 今日已收 2 条，只剩 1 配额
    const scores = [50, 95, 70];
    let draftCall = 0;
    const draft = vi.fn(async () => makeDraft(scores[draftCall++] ?? 0));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [makeItem(0), makeItem(1), makeItem(2)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    const inserted = decisions.filter((d) => d.action === 'insert');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].index).toBe(1); // 质量分最高的入选
    expect(decisions.filter((d) => d.skipReason === 'quota_exceeded')).toHaveLength(2);
  });

  it('autoApproveThreshold 达标直接 archived，理由带阈值说明', async () => {
    getGovernancePreferenceMock.mockResolvedValue({
      id: '1',
      userId: '42',
      categoryId: '7',
      dailyLimit: 3,
      focusRatio: 60,
      autoApproveThreshold: 85,
      excludeKeywords: [],
    });
    const draft = vi.fn(async () => makeDraft(90));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [makeItem(0)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0].status).toBe('archived');
    expect(decisions[0].draft?.aiReason).toContain('自动准奏阈值 85');
  });

  it('无偏好行时用默认值（dailyLimit 3 / focusRatio 60 / 不自动准奏）', async () => {
    const draft = vi.fn(async () => makeDraft(100));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: null,
        feedTitle: '订阅源',
        items: [makeItem(0)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(getGovernancePreferenceMock).not.toHaveBeenCalled();
    expect(decisions[0].status).toBe('candidate');
  });

  it('v2 归一化：URL 剥 utm 后命中去重，全角标题归一后命中去重', async () => {
    listExistingArticleLinksMock.mockResolvedValue(['https://example.com/post/42']);
    listRecentArticleTitlesMock.mockResolvedValue(['ＯｐｅｎＡＩ发布新模型🔥']);
    const draft = vi.fn(async () => makeDraft(80));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [
          makeItem(0, { link: 'https://example.com/post/42?utm_source=rss&utm_medium=feed' }),
          makeItem(1, { title: 'OpenAI 发布新模型' }),
        ],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0].skipReason).toBe('duplicate_url');
    expect(decisions[1].skipReason).toBe('duplicate_title');
    expect(draft).not.toHaveBeenCalled();
  });

  it('方向分类：关键词命中落 directionKey，未命中兜底 general（权重 0 不配额度跳过）', async () => {
    listDirectionStrategiesMock.mockResolvedValue([
      { key: 'money', name: '搞钱', keywordsDsl: '变现 副业', aiHint: '', quotaWeight: 30, updatedAt: '2026-09-05T00:00:00Z' },
      { key: 'general', name: '其他', keywordsDsl: '', aiHint: '', quotaWeight: 0, updatedAt: '2026-09-05T00:00:00Z' },
    ]);
    const draft = vi.fn(async () => makeDraft(80));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [
          makeItem(0, { title: '一个可复制的副业变现案例拆解' }),
          makeItem(1),
        ],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0]).toMatchObject({ action: 'insert', directionKey: 'money' });
    expect(decisions[0].directionReason).toContain('变现');
    // general 权重 0：关键词兜底命中 general 后不主动分配配额（P2c 语义）
    expect(decisions[1]).toMatchObject({
      action: 'skip',
      skipReason: 'quota_exceeded',
      directionKey: 'general',
    });
    expect(decisions[1].directionReason).toContain('未命中');
  });

  it('P2c 方向语义：关键词命中优先于 AI 分类', async () => {
    listDirectionStrategiesMock.mockResolvedValue([
      { key: 'money', name: '搞钱', keywordsDsl: '变现', aiHint: '商机', quotaWeight: 30, updatedAt: '2026-09-05T00:00:00Z' },
      { key: 'topic', name: '选题', keywordsDsl: '', aiHint: '热点', quotaWeight: 40, updatedAt: '2026-09-05T00:00:00Z' },
    ]);
    // AI 说是 topic，但关键词命中 money → 关键词赢
    const draft = vi.fn(async () => makeDraft(80, { directionKey: 'topic', directionReason: '像热点', directionConfidence: 0.95 }));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [makeItem(0, { title: '这个变现案例火了' })],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0].directionKey).toBe('money');
    expect(decisions[0].directionReason).toContain('命中关键词');
  });

  it('P2c 方向语义：关键词未命中时采信 AI（置信度达标），并带 algo 版本前缀', async () => {
    listDirectionStrategiesMock.mockResolvedValue([
      { key: 'money', name: '搞钱', keywordsDsl: '变现', aiHint: '商机', quotaWeight: 30, updatedAt: '2026-09-05T00:00:00Z' },
      { key: 'learning', name: '学习', keywordsDsl: '', aiHint: '干货', quotaWeight: 30, updatedAt: '2026-09-06T00:00:00Z' },
      { key: 'general', name: '其他', keywordsDsl: '', aiHint: '兜底', quotaWeight: 0, updatedAt: '2026-09-04T00:00:00Z' },
    ]);
    const draft = vi.fn(async () => makeDraft(80, { directionKey: 'learning', directionReason: '深度教程', directionConfidence: 0.83 }));
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: '订阅源',
        items: [makeItem(0)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0].directionKey).toBe('learning');
    expect(decisions[0].directionReason).toContain('[algo d3-w60-t');
    expect(decisions[0].directionReason).toContain('AI 分类');
    expect(decisions[0].directionReason).toContain('0.83');
  });

  it('P2c 方向语义：AI 置信度 <0.6 / 幻觉 key / 回退 → 落 general', async () => {
    listDirectionStrategiesMock.mockResolvedValue([
      { key: 'money', name: '搞钱', keywordsDsl: '', aiHint: '商机', quotaWeight: 30, updatedAt: '2026-09-05T00:00:00Z' },
      { key: 'general', name: '其他', keywordsDsl: '', aiHint: '', quotaWeight: 0, updatedAt: '2026-09-05T00:00:00Z' },
    ]);
    // 低置信
    let draft = vi.fn(async () => makeDraft(80, { directionKey: 'money', directionConfidence: 0.42 }));
    let decisions = await evaluateGovernanceBatch(
      pool,
      { categoryId: '7', feedTitle: 's', items: [makeItem(0)], aiConfig: null, userId: '42' },
      { draft },
    );
    expect(decisions[0].directionKey).toBe('general');

    // 幻觉 key（不在启用模板里）
    draft = vi.fn(async () => makeDraft(80, { directionKey: 'crypto', directionConfidence: 0.99 }));
    decisions = await evaluateGovernanceBatch(
      pool,
      { categoryId: '7', feedTitle: 's', items: [makeItem(0)], aiConfig: null, userId: '42' },
      { draft },
    );
    expect(decisions[0].directionKey).toBe('general');

    // 回退模式（direction 字段全 null）
    draft = vi.fn(async () => makeDraft(60, { usedFallback: true }));
    decisions = await evaluateGovernanceBatch(
      pool,
      { categoryId: '7', feedTitle: 's', items: [makeItem(0)], aiConfig: null, userId: '42' },
      { draft },
    );
    expect(decisions[0].directionKey).toBe('general');
  });

  it('P2c 方向配额：按权重归一化分配，无候选方向余量顺延', async () => {
    getGovernancePreferenceMock.mockResolvedValue({
      id: '1', userId: '42', categoryId: '7',
      dailyLimit: 4, focusRatio: 100, autoApproveThreshold: 0, excludeKeywords: [],
    });
    listDirectionStrategiesMock.mockResolvedValue([
      { key: 'topic', name: '选题', keywordsDsl: '', aiHint: '', quotaWeight: 50, updatedAt: '2026-09-05T00:00:00Z' },
      { key: 'money', name: '搞钱', keywordsDsl: '', aiHint: '', quotaWeight: 50, updatedAt: '2026-09-05T00:00:00Z' },
      { key: 'general', name: '其他', keywordsDsl: '', aiHint: '', quotaWeight: 0, updatedAt: '2026-09-05T00:00:00Z' },
    ]);
    // AI 把前三条都分到 topic，第四条分到 money。
    // topic 配额 2、money 配额 2 → topic 第三条应顺延占用 money 的剩余 1 个名额
    // （money 只有 1 条候选）→ 最终收 4 条中的 4 条？topic 3 + money 1 = 4 ≤ dailyLimit 4。
    const keys = ['topic', 'topic', 'topic', 'money'];
    let call = 0;
    const draft = vi.fn(async () =>
      makeDraft(90 - call, { directionKey: keys[call], directionConfidence: 0.9, ...(call++ >= 0 ? {} : {}) }),
    );
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: 's',
        items: [makeItem(0), makeItem(1), makeItem(2), makeItem(3)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    const inserted = decisions.filter((d) => d.action === 'insert');
    expect(inserted).toHaveLength(4);
    // 第四条（money 唯一候选）必收；topic 第三条靠顺延收录
    expect(inserted.map((d) => d.directionKey).sort()).toEqual(['money', 'topic', 'topic', 'topic']);
  });

  it('P2c 方向配额：general 权重 0 不主动分配，但高分可被动直通归档', async () => {
    getGovernancePreferenceMock.mockResolvedValue({
      id: '1', userId: '42', categoryId: '7',
      dailyLimit: 1, focusRatio: 100, autoApproveThreshold: 85, excludeKeywords: [],
    });
    listDirectionStrategiesMock.mockResolvedValue([
      { key: 'topic', name: '选题', keywordsDsl: '', aiHint: '', quotaWeight: 100, updatedAt: '2026-09-05T00:00:00Z' },
      { key: 'general', name: '其他', keywordsDsl: '', aiHint: '', quotaWeight: 0, updatedAt: '2026-09-05T00:00:00Z' },
    ]);
    // 两条 general：一条 95 分（直通 archived），一条 60 分（配额外跳过）；
    // 一条 topic 80 分（占唯一配额）。
    const plan = [
      { key: 'general', score: 95 },
      { key: 'general', score: 60 },
      { key: 'topic', score: 80 },
    ];
    let call = 0;
    const draft = vi.fn(async () => {
      const entry = plan[call++];
      return makeDraft(entry.score, { directionKey: entry.key, directionConfidence: 0.9 });
    });
    const decisions = await evaluateGovernanceBatch(
      pool,
      {
        categoryId: '7',
        feedTitle: 's',
        items: [makeItem(0), makeItem(1), makeItem(2)],
        aiConfig: null,
        userId: '42',
      },
      { draft },
    );
    expect(decisions[0]).toMatchObject({ action: 'insert', status: 'archived', directionKey: 'general' });
    expect(decisions[0].draft?.aiReason).toContain('兜底方向高分直通');
    expect(decisions[1]).toMatchObject({ action: 'skip', skipReason: 'quota_exceeded' });
    expect(decisions[2]).toMatchObject({ action: 'insert', directionKey: 'topic' });
  });
});
