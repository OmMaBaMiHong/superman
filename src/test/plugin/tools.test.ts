import { describe, expect, it } from 'vitest';
import { registerTools } from '@/plugin/host/tools';
import type { Queryable } from '@/plugin/host/db';

/** 捕获 ctx.inject(['tools']) 回调里的 tools.register 调用。 */
function makeCtx() {
  const registered: Record<string, unknown>[] = [];
  const disposers: (() => void)[] = [];
  const ctx = {
    inject(deps: string[], cb: (scope: never) => void) {
      expect(deps).toEqual(['tools']);
      cb({
        tools: {
          register(def: Record<string, unknown>) {
            registered.push(def);
            return () => {};
          },
        },
        effect(fn: () => () => void) {
          disposers.push(fn());
        },
      } as never);
    },
  };
  return { ctx, registered, disposers };
}

describe('plugin/host/tools', () => {
  it('注册 superman.ping 工具（schema + render + execute）', async () => {
    const { ctx, registered } = makeCtx();
    registerTools(ctx as never, { db: null });
    expect(registered).toHaveLength(1);
    const def = registered[0]!;
    expect(def.name).toBe('superman.ping');
    expect(typeof def.description).toBe('string');
    expect(def.parameters).toMatchObject({ type: 'object' });
    const execute = def.execute as () => Promise<{ pong: boolean; time: string; db: boolean }>;
    const out = await execute();
    expect(out.pong).toBe(true);
    expect(out.db).toBe(false);
    expect(new Date(out.time).getTime()).not.toBeNaN();
  });

  it('db 已连接时 execute 报告 db: true', async () => {
    const { ctx, registered } = makeCtx();
    const db = { query: async () => ({ rows: [] }) } as Queryable;
    registerTools(ctx as never, { db });
    const execute = registered[0]!.execute as () => Promise<{ db: boolean }>;
    expect((await execute()).db).toBe(true);
  });

  it('effect 清理函数注销工具', () => {
    const { ctx, disposers } = makeCtx();
    registerTools(ctx as never, { db: null });
    expect(disposers).toHaveLength(1);
    expect(() => disposers[0]!()).not.toThrow();
  });
});
