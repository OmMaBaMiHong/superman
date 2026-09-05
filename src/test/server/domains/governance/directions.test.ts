import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  BUILTIN_DIRECTION_SEEDS,
  DIRECTION_KEY_PATTERN,
  FALLBACK_DIRECTION_KEY,
  classifyByKeywords,
  createDirectionStrategy,
  deleteDirectionStrategy,
  ensureDirectionStrategiesSeeded,
  listDirectionStrategies,
  matchesParsedDsl,
  parseKeywordsDsl,
  updateDirectionStrategy,
} from '@/core/governance/directions';

function mockPool(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

describe('directions / 关键词 DSL 解析', () => {
  it('普通词 / +必须 / -排除 / /正则/ 四类词元', () => {
    const { tokens, errors } = parseKeywordsDsl('热搜 +突发 -广告 /热[门搜]/');
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.kind)).toEqual(['word', 'required', 'exclude', 'regex']);
    expect(tokens[1].value).toBe('突发');
    expect(tokens[2].value).toBe('广告');
  });

  it('非法正则记入 errors 不阻断', () => {
    const { tokens, errors } = parseKeywordsDsl('/[/ 正常词');
    expect(errors).toHaveLength(1);
    expect(tokens.map((t) => t.kind)).toEqual(['word']);
  });

  it('孤立 + / - 前缀按普通词处理', () => {
    const { tokens } = parseKeywordsDsl('+ -');
    expect(tokens.map((t) => t.kind)).toEqual(['word', 'word']);
  });
});

describe('directions / DSL 匹配语义', () => {
  const match = (dsl: string, text: string) =>
    matchesParsedDsl(parseKeywordsDsl(dsl), text.toLowerCase());

  it('普通词任一命中', () => {
    expect(match('热搜 爆款', '今天这个爆款刷屏了').matched).toBe(true);
    expect(match('热搜 爆款', '平淡的一天').matched).toBe(false);
  });

  it('+必须词全部命中才匹配，可与普通词组合', () => {
    expect(match('+AI +教程', 'AI 入门教程').matched).toBe(true);
    expect(match('+AI +教程', 'AI 新闻').matched).toBe(false);
    // 必须词命中但普通词未命中 → 不匹配
    expect(match('+AI 变现', 'AI 新闻').matched).toBe(false);
    expect(match('+AI 变现', 'AI 变现案例').matched).toBe(true);
  });

  it('-排除词命中即整体不匹配（优先级最高）', () => {
    expect(match('热搜 -广告', '这条热搜是广告').matched).toBe(false);
    expect(match('-广告 +教程', '广告里的教程').matched).toBe(false);
  });

  it('/正则/ 命中计入任一组', () => {
    expect(match('/热[门搜]/', '今日热门').matched).toBe(true);
    expect(match('/^重磅/', '重磅发布').matched).toBe(true);
    expect(match('/^重磅/', '消息称重磅').matched).toBe(false);
  });

  it('只有必须词时全部命中即匹配；空 DSL 永不匹配', () => {
    expect(match('+突发 +官宣', '突发消息，今晚官宣').matched).toBe(true);
    expect(match('', '任何文本').matched).toBe(false);
    expect(match('   ', '任何文本').matched).toBe(false);
  });
});

describe('directions / classifyByKeywords 分类优先级', () => {
  const strategies = [
    { key: 'topic', keywordsDsl: '热搜 爆款' },
    { key: 'money', keywordsDsl: '变现 副业' },
    { key: 'general', keywordsDsl: '' },
  ];

  it('按给定顺序（sort）先中先得', () => {
    const hit = classifyByKeywords('这个爆款项目的变现路径', '', strategies);
    expect(hit).toMatchObject({ directionKey: 'topic', matchedBy: 'keyword', matchedKeyword: '爆款' });
    // 调换顺序后 money 先中
    const reversed = classifyByKeywords('这个爆款项目的变现路径', '', [strategies[1], strategies[0], strategies[2]]);
    expect(reversed?.directionKey).toBe('money');
  });

  it('空 DSL（general 兜底）永不命中；全部未命中返回 null', () => {
    expect(classifyByKeywords('无关内容', '', strategies)).toBeNull();
    expect(classifyByKeywords('任何', '', [strategies[2]])).toBeNull();
  });

  it('摘要参与匹配且大小写不敏感', () => {
    const hit = classifyByKeywords('普通标题', '本文讲 Monetization 变现', [
      { key: 'money', keywordsDsl: '变现' },
    ]);
    expect(hit?.directionKey).toBe('money');
  });

  it('内置种子：四个 key 齐备且 general DSL 为空、权重 0', () => {
    expect(BUILTIN_DIRECTION_SEEDS.map((s) => s.key)).toEqual(['topic', 'money', 'learning', 'general']);
    const general = BUILTIN_DIRECTION_SEEDS.find((s) => s.key === FALLBACK_DIRECTION_KEY);
    expect(general?.keywordsDsl).toBe('');
    expect(general?.quotaWeight).toBe(0);
  });
});

describe('directions / repository CRUD（mock pool）', () => {
  it('lazy seed：每个内置模板 insert on conflict do nothing，按用户隔离', async () => {
    const { pool, query } = mockPool();
    await ensureDirectionStrategiesSeeded(pool, '42');
    expect(query).toHaveBeenCalledTimes(BUILTIN_DIRECTION_SEEDS.length);
    for (const call of query.mock.calls) {
      expect(String(call[0])).toContain('on conflict (user_id, key) do nothing');
      expect(call[1]?.[0]).toBe('42');
    }
  });

  it('list 先 seed 再按 sort 排序返回；enabledOnly 加 enabled 过滤', async () => {
    const { pool, query } = mockPool([]);
    await listDirectionStrategies(pool, { userId: '42', enabledOnly: true });
    const listSql = String(query.mock.calls[BUILTIN_DIRECTION_SEEDS.length][0]);
    expect(listSql).toContain('and enabled = true');
    expect(listSql).toContain('order by sort asc');
    expect(listSql).toContain('where user_id = $1');
  });

  it('create：builtin=false 落库', async () => {
    const row = { id: '9', key: 'tools', builtin: false };
    const { pool, query } = mockPool([row]);
    const result = await createDirectionStrategy(pool, { key: 'tools', name: '工具', userId: '42' });
    expect(result).toEqual(row);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('insert into direction_strategies');
    expect(sql).toContain('false');
    expect(query.mock.calls[0][1][1]).toBe('tools');
  });

  it('update：只更新传入字段，带 user_id + key 双过滤', async () => {
    const { pool, query } = mockPool([{ id: '1', key: 'money', quotaWeight: 50 }]);
    const result = await updateDirectionStrategy(pool, 'money', { quotaWeight: 50, enabled: false, userId: '42' });
    expect(result?.quotaWeight).toBe(50);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('quota_weight = $1');
    expect(sql).toContain('enabled = $2');
    expect(sql).toContain('updated_at = now()');
    expect(query.mock.calls[0][1]).toEqual([50, false, '42', 'money']);
  });

  it('update：无可更新字段返回 null 且不发 SQL', async () => {
    const { pool, query } = mockPool();
    expect(await updateDirectionStrategy(pool, 'money', { userId: '42' })).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('delete：builtin 不可删（SQL 侧校验），不存在 not_found，自建 deleted', async () => {
    const { pool, query } = mockPool([{ builtin: true }]);
    expect(await deleteDirectionStrategy(pool, 'topic', '42')).toBe('builtin');
    expect(query).toHaveBeenCalledTimes(1); // 只查不删

    const notFound = mockPool([]);
    expect(await deleteDirectionStrategy(notFound.pool, 'ghost', '42')).toBe('not_found');

    const okPool = mockPool([{ builtin: false }]);
    expect(await deleteDirectionStrategy(okPool.pool, 'tools', '42')).toBe('deleted');
    expect(String(okPool.query.mock.calls[1][0])).toContain('delete from direction_strategies');
  });

  it('key 格式校验常量与迁移 check 一致', () => {
    expect(DIRECTION_KEY_PATTERN.test('money')).toBe(true);
    expect(DIRECTION_KEY_PATTERN.test('my_dir_2')).toBe(true);
    expect(DIRECTION_KEY_PATTERN.test('Money')).toBe(false);
    expect(DIRECTION_KEY_PATTERN.test('2money')).toBe(false);
    expect(DIRECTION_KEY_PATTERN.test('a'.repeat(33))).toBe(false);
  });
});
