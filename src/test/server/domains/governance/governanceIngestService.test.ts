import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { evaluateGovernanceBatch } from '@/server/domains/governance/services/governanceIngestService';
import type { GovernanceDraft } from '@/server/domains/governance/aiDraft';

const getGovernancePreferenceMock = vi.fn();
const listExistingArticleLinksMock = vi.fn();
const listRecentRejectMemoryMock = vi.fn();
const listRecentArticleTitlesMock = vi.fn();
const countTodayGovernedByCategoryMock = vi.fn();

vi.mock('@/server/domains/governance/repository', () => ({
  getGovernancePreference: (...args: unknown[]) => getGovernancePreferenceMock(...args),
  listExistingArticleLinks: (...args: unknown[]) => listExistingArticleLinksMock(...args),
  listRecentRejectMemory: (...args: unknown[]) => listRecentRejectMemoryMock(...args),
  listRecentArticleTitles: (...args: unknown[]) => listRecentArticleTitlesMock(...args),
  countTodayGovernedByCategory: (...args: unknown[]) => countTodayGovernedByCategoryMock(...args),
}));

const pool = {} as Pool;

function makeDraft(score: number): GovernanceDraft {
  return { title: '拟折标题', summary: '拟折摘要', aiReason: '拟折理由', qualityScore: score, usedFallback: false };
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
});
