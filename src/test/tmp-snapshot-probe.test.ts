import { describe, it, expect } from 'vitest';
import { getPool } from '@/server/infra/db/pool';
import { getReaderSnapshot } from '@/server/domains/reader/services/readerSnapshotService';
import { OVERVIEW_VIEW_ID, PUBLISH_CENTER_VIEW_ID } from '@/lib/reader/view';

describe('snapshot real-db probe (temporary)', () => {
  it('view=all', async () => {
    const pool = getPool();
    const res = await getReaderSnapshot(pool, { view: 'all', userId: '1' });
    expect(res).toBeDefined();
  }, 30000);

  it('view=overview returns empty list (content page guard)', async () => {
    const pool = getPool();
    const res = await getReaderSnapshot(pool, { view: OVERVIEW_VIEW_ID, userId: '1' });
    expect(res.articles.items).toEqual([]);
    expect(res.articles.totalCount).toBe(0);
  }, 30000);

  it('view=publish-center returns empty list (content page guard)', async () => {
    const pool = getPool();
    const res = await getReaderSnapshot(pool, { view: PUBLISH_CENTER_VIEW_ID, userId: '1' });
    expect(res.articles.items).toEqual([]);
    expect(res.articles.totalCount).toBe(0);
  }, 30000);
});
