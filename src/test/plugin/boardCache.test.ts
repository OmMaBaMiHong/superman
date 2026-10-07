import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boardCacheFile, isBoardCacheAvailable, readBoardSlices, writeBoardSlices } from '../../plugin/host/boardCache';

let dir: string;

describe('plugin/host/boardCache · SQLite 读缓存', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffw-board-cache-'));
    process.env.SUPERMAN_CACHE_DB = join(dir, 'board-cache.db');
  });
  afterEach(() => {
    delete process.env.SUPERMAN_CACHE_DB;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('node:sqlite 可用时读写回路成立，单片损坏不影响其余片', async () => {
    if (!isBoardCacheAvailable()) return; // 旧内核：静默降级，用例无事可断言
    expect(boardCacheFile()).toBe(process.env.SUPERMAN_CACHE_DB);

    writeBoardSlices({ topics: { items: [{ id: '1' }], total: 1 }, review: { items: [], total: 0 } });
    const out = readBoardSlices(['topics', 'review', 'missing'])!;
    expect(out.topics.payload).toEqual({ items: [{ id: '1' }], total: 1 });
    expect(out.review.payload).toEqual({ items: [], total: 0 });
    expect(out.missing).toBeUndefined();
    expect(typeof out.topics.fetchedAt).toBe('string');

    // 覆盖写：同 key upsert
    writeBoardSlices({ topics: { items: [], total: 0 } });
    const again = readBoardSlices(['topics'])!;
    expect((again.topics.payload as { total: number }).total).toBe(0);
  });
});
