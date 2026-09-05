import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  acceptDraft,
  createPipelineJobIfAbsent,
  findActivePipelineJob,
  getDraftDetail,
  getPipelineArticle,
  listDrafts,
  listPipelineJobs,
  requeuePipelineJob,
} from '@/server/domains/pipelines/repository';

function mockPool(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

const JOB = {
  id: '5',
  userId: '42',
  articleId: '11',
  kind: 'rewrite',
  platform: 'wechat',
  status: 'queued',
  inputJson: {},
  outputJson: null,
  error: null,
  attempts: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('pipelines repository / 多用户隔离', () => {
  it('所有查询带 user_id 过滤', async () => {
    const { pool, query } = mockPool();
    await getPipelineArticle(pool, '11', '42');
    await findActivePipelineJob(pool, { articleId: '11', kind: 'rewrite', platform: 'xhs', userId: '42' });
    await listPipelineJobs(pool, { userId: '42' });
    await listDrafts(pool, { userId: '42' });
    await getDraftDetail(pool, '1', '42');

    for (const call of query.mock.calls) {
      const sql = String(call[0]);
      expect(sql).toMatch(/user_id = \$\d+|d\.user_id = \$\d+|j\.user_id = \$\d+/);
      expect(call[1]).toContain('42');
    }
  });
});

describe('pipelines repository / job 幂等创建', () => {
  it('已有活跃任务时直接复用，不发 insert', async () => {
    const { pool, query } = mockPool([{ ...JOB, status: 'running' }]);
    const result = await createPipelineJobIfAbsent(pool, {
      articleId: '11',
      kind: 'rewrite',
      platform: 'wechat',
      userId: '42',
    });
    expect(result.reused).toBe(true);
    expect(result.job.id).toBe('5');
    expect(query).toHaveBeenCalledTimes(1); // 只有 findActive 的 select
    expect(String(query.mock.calls[0][0])).toContain("status in ('queued', 'running')");
  });

  it('无活跃任务时 insert，且用部分唯一索引 on conflict 兜底并发', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // findActive: 无
      .mockResolvedValueOnce({ rows: [JOB] }); // insert 成功
    const pool = { query } as unknown as Pool;
    const result = await createPipelineJobIfAbsent(pool, {
      articleId: '11',
      kind: 'rewrite',
      platform: 'wechat',
      userId: '42',
    });
    expect(result.reused).toBe(false);
    const insertSql = String(query.mock.calls[1][0]);
    expect(insertSql).toContain('insert into pipeline_jobs');
    expect(insertSql).toContain("on conflict (user_id, article_id, kind, platform)");
    expect(insertSql).toContain("where status in ('queued', 'running')");
  });

  it('并发抢插时回读活跃任务并标记 reused', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // findActive: 无
      .mockResolvedValueOnce({ rows: [] }) // insert 被并发抢占（do nothing）
      .mockResolvedValueOnce({ rows: [JOB] }); // 回读命中
    const pool = { query } as unknown as Pool;
    const result = await createPipelineJobIfAbsent(pool, {
      articleId: '11',
      kind: 'rewrite',
      platform: 'wechat',
      userId: '42',
    });
    expect(result.reused).toBe(true);
    expect(result.job.id).toBe('5');
  });
});

describe('pipelines repository / retry 与 accept', () => {
  it('requeue 仅匹配 failed 状态且带用户过滤', async () => {
    const { pool, query } = mockPool([{ ...JOB, status: 'queued' }]);
    const job = await requeuePipelineJob(pool, '5', '42');
    expect(job?.status).toBe('queued');
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("and status = 'failed'");
    expect(query.mock.calls[0][1]).toEqual(['5', '42']);
  });

  it('accept 仅允许 draft/accepted 状态', async () => {
    const { pool, query } = mockPool([]);
    const result = await acceptDraft(pool, '9', '42');
    expect(result).toBeNull();
    expect(String(query.mock.calls[0][0])).toContain("and status in ('draft', 'accepted')");
  });
});
