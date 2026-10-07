import { describe, expect, it, vi } from 'vitest';
import { updateArticleUserNote } from '@/server/domains/articles/repositories/articlesRepo';

describe('articlesRepo · updateArticleUserNote', () => {
  it('写入 note（并可选 title），SQL 带 user_id 谓词', async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    const ok = await updateArticleUserNote({ query } as never, {
      id: '892596',
      userId: '1',
      note: '这条适合做短剧',
      title: '新标题',
    });
    expect(ok).toBe(true);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('user_note = $3');
    expect(sql).toContain('title = $4');
    expect(sql).toContain('where id = $1 and user_id = $2');
    expect(params).toEqual(['892596', '1', '这条适合做短剧', '新标题']);
  });

  it('只改 note 时只更新 user_note', async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    await updateArticleUserNote({ query } as never, { id: '1', userId: '1', note: '想法' });
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toContain('user_note = $3');
    expect(sql).not.toContain('title =');
  });

  it('无任何字段时不发查询', async () => {
    const query = vi.fn();
    const ok = await updateArticleUserNote({ query } as never, { id: '1', userId: '1' });
    expect(ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
