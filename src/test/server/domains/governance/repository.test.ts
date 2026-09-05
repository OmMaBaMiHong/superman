import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  countTodayGovernedByCategory,
  getGovernanceItem,
  getGovernanceStats,
  insertRejectLog,
  listExistingArticleLinks,
  listGovernanceQueue,
  listRecentArticleTitles,
  listRecentRejectMemory,
  transitionGovernanceStatus,
} from '@/server/domains/governance/repository';

function mockPool(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

const GOVERNANCE_ITEM = {
  id: '11',
  feedId: '3',
  categoryId: '7',
  title: '标题',
  titleOriginal: '原始标题',
  summary: '摘要',
  contentHtml: '<p>正文</p>',
  link: 'https://example.com/a',
  governanceStatus: 'candidate',
  qualityScore: 80,
  aiReason: '理由',
  redraftCount: 0,
};

describe('governance repository / 多用户隔离', () => {
  it('所有查询都带 user_id 过滤', async () => {
    const { pool, query } = mockPool();
    await listExistingArticleLinks(pool, ['https://a'], '42');
    await listRecentArticleTitles(pool, { userId: '42' });
    await listRecentRejectMemory(pool, { userId: '42' });
    await countTodayGovernedByCategory(pool, { categoryId: '7', userId: '42' });
    await listGovernanceQueue(pool, { userId: '42' });
    await getGovernanceStats(pool, '42');
    await getGovernanceItem(pool, '11', '42');

    for (const call of query.mock.calls) {
      const sql = String(call[0]);
      expect(sql).toMatch(/user_id = \$\d+/);
      expect(call[1]).toContain('42');
    }
  });

  it('categoryId 为 null 时统计未分类（feeds.category_id is null）', async () => {
    const { pool, query } = mockPool([{ count: 2 }]);
    const count = await countTodayGovernedByCategory(pool, { categoryId: null, userId: '1' });
    expect(count).toBe(2);
    expect(String(query.mock.calls[0][0])).toContain('feeds.category_id is null');
  });

  it('insertRejectLog 落库标题与来源 URL（7 天去重记忆）', async () => {
    const { pool, query } = mockPool();
    await insertRejectLog(pool, {
      userId: '42',
      articleId: '11',
      reason: '低质量',
      title: '标题',
      sourceUrl: 'https://example.com/a',
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('insert into reject_logs');
    expect(query.mock.calls[0][1]).toEqual([
      '42',
      '11',
      '低质量',
      '标题',
      'https://example.com/a',
    ]);
  });
});

describe('governance repository / transitionGovernanceStatus', () => {
  it('条目不存在返回 not_found', async () => {
    const { pool } = mockPool([]);
    const result = await transitionGovernanceStatus(pool, { id: '11', to: 'archived', userId: '1' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('非法迁移返回 illegal_transition 且不执行 update', async () => {
    const { pool, query } = mockPool([{ ...GOVERNANCE_ITEM, governanceStatus: 'used' }]);
    const result = await transitionGovernanceStatus(pool, { id: '11', to: 'archived', userId: '1' });
    expect(result).toEqual({ ok: false, reason: 'illegal_transition', currentStatus: 'used' });
    expect(query).toHaveBeenCalledTimes(1); // 只有 select，没有 update
  });

  it('合法迁移落库并更新 governance_updated_at', async () => {
    const { pool, query } = mockPool([GOVERNANCE_ITEM]);
    const result = await transitionGovernanceStatus(pool, { id: '11', to: 'archived', userId: '1' });
    expect(result.ok).toBe(true);
    const updateSql = String(query.mock.calls[1][0]);
    expect(updateSql).toContain('update articles');
    expect(updateSql).toContain('governance_status = $3');
    expect(updateSql).toContain('governance_updated_at = now()');
    expect(query.mock.calls[1][1]).toEqual(['11', '1', 'archived']);
  });

  it('redraft patch：更新拟折字段并 redraft_count + 1', async () => {
    const { pool, query } = mockPool([GOVERNANCE_ITEM]);
    const result = await transitionGovernanceStatus(pool, {
      id: '11',
      to: 'pending',
      userId: '1',
      patch: {
        title: '新标题',
        summary: '新摘要',
        aiReason: '新理由',
        qualityScore: 88,
        incrementRedraftCount: true,
      },
    });
    expect(result.ok).toBe(true);
    const updateSql = String(query.mock.calls[1][0]);
    expect(updateSql).toContain('redraft_count = redraft_count + 1');
    expect(updateSql).toContain('ai_reason = $');
    expect(query.mock.calls[1][1]).toEqual(['11', '1', 'pending', '新标题', '新摘要', '新理由', 88]);
  });

  it('同状态迁移视为幂等 no-op（pending 上重拟）', async () => {
    const { pool, query } = mockPool([{ ...GOVERNANCE_ITEM, governanceStatus: 'pending' }]);
    const result = await transitionGovernanceStatus(pool, { id: '11', to: 'pending', userId: '1' });
    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('governance repository / listGovernanceQueue', () => {
  it('默认返回 candidate + pending，支持状态/分类/分页过滤', async () => {
    const { pool, query } = mockPool([{ count: 0 }]);
    await listGovernanceQueue(pool, {
      userId: '42',
      statuses: ['candidate'],
      categoryId: '7',
      page: 2,
      pageSize: 10,
    });
    const countSql = String(query.mock.calls[0][0]);
    expect(countSql).toContain('a.governance_status = any($2::text[])');
    expect(countSql).toContain('f.category_id = $3');
    expect(query.mock.calls[0][1]).toEqual(['42', ['candidate'], '7']);
    // 第二页 offset = 10
    expect(query.mock.calls[1][1]).toEqual(['42', ['candidate'], '7', 10, 10]);
  });

  it('缺省状态过滤为 candidate + pending', async () => {
    const { pool, query } = mockPool([{ count: 0 }]);
    await listGovernanceQueue(pool, { userId: '1' });
    expect(query.mock.calls[0][1][1]).toEqual(['candidate', 'pending']);
  });
});
