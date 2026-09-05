/**
 * 治理 v2 ③ 方向分类：策略模板化（方向 = 一行模板，加方向零代码）。
 *
 * 关键词 DSL（TrendRadar 简版），空格分隔多个词元：
 *   普通词     任一命中即匹配（OR）
 *   +必须词    全部必须命中（AND），可与其他词元组合
 *   -排除词    命中即整体不匹配（NOT，优先级最高）
 *   /正则/     按正则命中，计入「任一命中」组
 * 判定顺序：排除词 > 必须词 > 任一词。只有必须词时，全部命中即匹配。
 *
 * 分类器按模板 sort 升序逐条匹配，先中先得（sort 即优先级）。
 * 模板按 user_id 隔离，内置四个模板在首次访问时 lazy seed。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';

type DbClient = Pool | PoolClient;

// ============================================================
// 内置模板种子（每用户一份，lazy seed）
// ============================================================

export interface DirectionSeed {
  key: string;
  name: string;
  color: string;
  icon: string;
  keywordsDsl: string;
  aiHint: string;
  quotaWeight: number;
  sort: number;
}

export const BUILTIN_DIRECTION_SEEDS: readonly DirectionSeed[] = [
  {
    key: 'topic',
    name: '选题',
    color: '#ef4444',
    icon: '🔥',
    keywordsDsl: '热搜 爆款 刷屏 热议 首发 突发 官宣 登顶 冲上 霸榜 全网 破圈 爆红 刷屏级',
    aiHint: '今天值得口播或二创的热点素材：热点事件、爆款视频、热议话题、突发新闻。',
    quotaWeight: 40,
    sort: 10,
  },
  {
    key: 'money',
    name: '搞钱',
    color: '#f59e0b',
    icon: '💰',
    keywordsDsl: '变现 副业 红利 赚钱 佣金 带货 课程 接单 差价 蓝海 风口 搞钱 商业模式 睡后收入',
    aiHint: '别人的文稿或热点里的商机灵感：变现案例、新平台红利、工具差价、可复制的商业模式。',
    quotaWeight: 30,
    sort: 20,
  },
  {
    key: 'learning',
    name: '学习',
    color: '#3b82f6',
    icon: '📚',
    keywordsDsl: '教程 指南 方法论 深度 万字 原理 实战 详解 复盘 手把手 硬核 入门 进阶 最佳实践',
    aiHint: '真干货、值得收藏的内容：深度教程、方法论、行业分析、原理拆解。',
    quotaWeight: 30,
    sort: 30,
  },
  {
    key: 'general',
    name: '其他',
    color: '#6b7280',
    icon: '📦',
    keywordsDsl: '',
    aiHint: '不属于任何方向的兜底分类。',
    // 兜底方向权重 0：不参与主动配额分配（P2c），只被动收纳未命中的文章。
    quotaWeight: 0,
    sort: 99,
  },
];

// ============================================================
// 关键词 DSL 解析与匹配（纯函数）
// ============================================================

export type DslTokenKind = 'word' | 'required' | 'exclude' | 'regex';

export interface DslToken {
  kind: DslTokenKind;
  value: string;
  regex?: RegExp;
}

export interface ParsedDsl {
  tokens: DslToken[];
  /** 无法编译的正则等解析问题（不阻断，记入 errors）。 */
  errors: string[];
}

export function parseKeywordsDsl(dsl: string): ParsedDsl {
  const tokens: DslToken[] = [];
  const errors: string[] = [];
  for (const raw of dsl.split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('+') && raw.length > 1) {
      tokens.push({ kind: 'required', value: raw.slice(1).toLowerCase() });
    } else if (raw.startsWith('-') && raw.length > 1) {
      tokens.push({ kind: 'exclude', value: raw.slice(1).toLowerCase() });
    } else if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
      try {
        tokens.push({ kind: 'regex', value: raw.slice(1, -1), regex: new RegExp(raw.slice(1, -1), 'i') });
      } catch {
        errors.push(`无法编译的正则：${raw}`);
      }
    } else {
      tokens.push({ kind: 'word', value: raw.toLowerCase() });
    }
  }
  return { tokens, errors };
}

export interface DslMatchResult {
  matched: boolean;
  /** 命中的词元原文（用于 direction_reason 展示）。 */
  matchedToken: string | null;
}

/** 用解析后的 DSL 匹配一段文本（调用方负责拼 title+summary 并转小写）。 */
export function matchesParsedDsl(parsed: ParsedDsl, textLower: string): DslMatchResult {
  if (parsed.tokens.length === 0) return { matched: false, matchedToken: null };

  for (const token of parsed.tokens) {
    if (token.kind === 'exclude' && textLower.includes(token.value)) {
      return { matched: false, matchedToken: null };
    }
  }
  for (const token of parsed.tokens) {
    if (token.kind === 'required' && !textLower.includes(token.value)) {
      return { matched: false, matchedToken: null };
    }
  }

  const anyTokens = parsed.tokens.filter((t) => t.kind === 'word' || t.kind === 'regex');
  if (anyTokens.length === 0) {
    // 只有必须词：全部命中即匹配。
    return { matched: true, matchedToken: parsed.tokens.find((t) => t.kind === 'required')?.value ?? null };
  }
  for (const token of anyTokens) {
    const hit =
      token.kind === 'regex' ? token.regex!.test(textLower) : textLower.includes(token.value);
    if (hit) return { matched: true, matchedToken: token.value };
  }
  return { matched: false, matchedToken: null };
}

// ============================================================
// 模板 repository（按用户隔离 + lazy seed）
// ============================================================

export interface DirectionStrategyRow {
  id: string;
  userId: string;
  key: string;
  name: string;
  color: string;
  icon: string;
  keywordsDsl: string;
  aiHint: string;
  quotaWeight: number;
  enabled: boolean;
  sort: number;
  builtin: boolean;
}

const strategySelectSql = `
  id,
  user_id::text as "userId",
  key,
  name,
  color,
  icon,
  keywords_dsl as "keywordsDsl",
  ai_hint as "aiHint",
  quota_weight as "quotaWeight",
  enabled,
  sort,
  builtin
`;

/** 内置模板 lazy seed：每用户首次访问时插入，幂等。 */
export async function ensureDirectionStrategiesSeeded(db: DbClient, userId?: string): Promise<void> {
  const scopedUserId = normalizeUserId(userId);
  for (const seed of BUILTIN_DIRECTION_SEEDS) {
    await db.query(
      `
        insert into direction_strategies(
          user_id, key, name, color, icon, keywords_dsl, ai_hint, quota_weight, sort, builtin
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        on conflict (user_id, key) do nothing
      `,
      [
        scopedUserId,
        seed.key,
        seed.name,
        seed.color,
        seed.icon,
        seed.keywordsDsl,
        seed.aiHint,
        seed.quotaWeight,
        seed.sort,
      ],
    );
  }
}

export async function listDirectionStrategies(
  db: DbClient,
  input?: { userId?: string; enabledOnly?: boolean },
): Promise<DirectionStrategyRow[]> {
  const scopedUserId = normalizeUserId(input?.userId);
  await ensureDirectionStrategiesSeeded(db, scopedUserId);
  const { rows } = await db.query<DirectionStrategyRow>(
    `
      select ${strategySelectSql}
      from direction_strategies
      where user_id = $1
        ${input?.enabledOnly ? 'and enabled = true' : ''}
      order by sort asc, id asc
    `,
    [scopedUserId],
  );
  return rows;
}

export const DIRECTION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** 新建自定义模板（builtin=false）；key 冲突抛 23505 由上层转 409。 */
export async function createDirectionStrategy(
  db: DbClient,
  input: {
    key: string;
    name: string;
    color?: string;
    icon?: string;
    keywordsDsl?: string;
    aiHint?: string;
    quotaWeight?: number;
    sort?: number;
    userId?: string;
  },
): Promise<DirectionStrategyRow> {
  const { rows } = await db.query<DirectionStrategyRow>(
    `
      insert into direction_strategies(
        user_id, key, name, color, icon, keywords_dsl, ai_hint, quota_weight, sort, builtin
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
      returning ${strategySelectSql}
    `,
    [
      normalizeUserId(input.userId),
      input.key,
      input.name,
      input.color ?? '#6b7280',
      input.icon ?? '',
      input.keywordsDsl ?? '',
      input.aiHint ?? '',
      input.quotaWeight ?? 0,
      input.sort ?? 50,
    ],
  );
  return rows[0];
}

/** 更新模板（builtin 可改不可删）。未命中返回 null。 */
export async function updateDirectionStrategy(
  db: DbClient,
  key: string,
  input: {
    name?: string;
    color?: string;
    icon?: string;
    keywordsDsl?: string;
    aiHint?: string;
    quotaWeight?: number;
    enabled?: boolean;
    sort?: number;
    userId?: string;
  },
): Promise<DirectionStrategyRow | null> {
  const scopedUserId = normalizeUserId(input.userId);
  const fields: string[] = [];
  const values: Array<string | number | boolean> = [];
  let paramIndex = 1;

  const push = (column: string, value: string | number | boolean) => {
    fields.push(`${column} = $${paramIndex++}`);
    values.push(value);
  };
  if (typeof input.name !== 'undefined') push('name', input.name);
  if (typeof input.color !== 'undefined') push('color', input.color);
  if (typeof input.icon !== 'undefined') push('icon', input.icon);
  if (typeof input.keywordsDsl !== 'undefined') push('keywords_dsl', input.keywordsDsl);
  if (typeof input.aiHint !== 'undefined') push('ai_hint', input.aiHint);
  if (typeof input.quotaWeight !== 'undefined') push('quota_weight', input.quotaWeight);
  if (typeof input.enabled !== 'undefined') push('enabled', input.enabled);
  if (typeof input.sort !== 'undefined') push('sort', input.sort);
  if (fields.length === 0) return null;

  fields.push('updated_at = now()');
  values.push(scopedUserId, key);

  const { rows } = await db.query<DirectionStrategyRow>(
    `
      update direction_strategies
      set ${fields.join(', ')}
      where user_id = $${paramIndex++}
        and key = $${paramIndex++}
      returning ${strategySelectSql}
    `,
    values,
  );
  return rows[0] ?? null;
}

export type DeleteDirectionResult = 'deleted' | 'not_found' | 'builtin';

/** 删除模板：builtin 不可删（校验在 SQL 侧，防绕过）。 */
export async function deleteDirectionStrategy(
  db: DbClient,
  key: string,
  userId?: string,
): Promise<DeleteDirectionResult> {
  const scopedUserId = normalizeUserId(userId);
  const { rows } = await db.query<{ builtin: boolean }>(
    'select builtin from direction_strategies where user_id = $1 and key = $2 limit 1',
    [scopedUserId, key],
  );
  if (!rows[0]) return 'not_found';
  if (rows[0].builtin) return 'builtin';
  await db.query('delete from direction_strategies where user_id = $1 and key = $2', [
    scopedUserId,
    key,
  ]);
  return 'deleted';
}

// ============================================================
// 关键词分类器
// ============================================================

export interface DirectionClassification {
  directionKey: string;
  matchedBy: 'keyword';
  matchedKeyword: string | null;
}

/**
 * 关键词派分类：按模板 sort 顺序先中先得。
 * 全部未命中返回 null（调用方落兜底 general）。
 */
export function classifyByKeywords(
  title: string,
  summary: string,
  strategies: readonly Pick<DirectionStrategyRow, 'key' | 'keywordsDsl'>[],
): DirectionClassification | null {
  const textLower = `${title} ${summary}`.toLowerCase();
  for (const strategy of strategies) {
    if (!strategy.keywordsDsl.trim()) continue;
    const result = matchesParsedDsl(parseKeywordsDsl(strategy.keywordsDsl), textLower);
    if (result.matched) {
      return {
        directionKey: strategy.key,
        matchedBy: 'keyword',
        matchedKeyword: result.matchedToken,
      };
    }
  }
  return null;
}

/** 兜底方向 key（治理管线与拟折回退共用）。 */
export const FALLBACK_DIRECTION_KEY = 'general';
