import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PglitePool } from '../../plugin/host/pgliteAdapter';
import { loadMigrations, runMigrations } from '../../plugin/host/scheduler';
import { buildStudioBoardSlices, pickBoardSlices, unwrapBoardSlices } from '../../plugin/host/studioBoard';
import { readBoardSlices, writeBoardSlices } from '../../plugin/host/boardCache';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ffw-board-contract-'));
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * 看板信封契约（2026-10-08 黑屏回归）：
 * 服务端曾把缓存片包成 {payload, fetchedAt}，客户端直接读 items → undefined → 面板黑屏。
 * 本测试锁定：write → read → unwrap / pick 的产物必须始终是「客户端内层形状」，
 * 与 apiClient 的 StudioBoardSlices（{review:{items,total}, …}）逐字段一致。
 */
describe('studio/board 信封契约 · 服务端产物 = 客户端内层形状', () => {
  it('构建 → 落缓存 → 读缓存 → 解包：五片均为内层形状且与直取一致', async () => {
    const pool = await PglitePool.open(dir);
    try {
      const migDir = join(process.cwd(), 'src', 'server', 'infra', 'db', 'migrations');
      await runMigrations(pool, loadMigrations(migDir)); // 真实 71 迁移：builder 跑的是真 SQL
      const keys = ['review', 'topics', 'drafts', 'published', 'jobs'];

      const built = (await buildStudioBoardSlices(pool, '1')) as unknown as Record<string, unknown>;
      writeBoardSlices(built);

      const cached = readBoardSlices(keys);
      expect(cached).not.toBeNull();

      // 缓存命中路径（服务端 unwrap）——曾在此处漏解 payload 导致黑屏
      const fromCache = unwrapBoardSlices(cached!, keys);
      // 源库重建路径（服务端 pick）
      const fromDb = pickBoardSlices(built, keys);

      for (const key of keys) {
        expect(fromCache[key]).toEqual(fromDb[key]); // 两条路径形状逐字节一致
        const slice = fromCache[key] as { items: unknown[]; total?: number };
        expect(Array.isArray(slice.items)).toBe(true); // 客户端直接 slice.items.map —— 必须是数组
        if (key === 'review' || key === 'topics') expect(typeof slice.total).toBe('number');
      }
      expect((fromCache.topics as { total: number }).total).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('缺片时解包产出 undefined（客户端 applyBoardSlices 须以空数组兜底）', () => {
    const cached = { review: { payload: { items: [], total: 0 } } };
    const out = unwrapBoardSlices(cached as never, ['review', 'topics']);
    expect(out.review).toEqual({ items: [], total: 0 });
    expect(out.topics).toBeUndefined();
  });
});
