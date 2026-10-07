/**
 * 产品计划（商业决策 MVP 规划）仓储。
 *
 * 两个数据来源汇入同一张 product_plans 表：
 *   - manual：用户口述/输入的想法（备忘录式），直接落成计划；
 *   - ai_inferred：AI 从采集/清洗/打标后的内容推理出的产品机会。
 *
 * 计划本身是一份结构化 MVP 规划：产品描述 / 目标人群·客户 / 思路打法 /
 * 商业模式 / 风险 / 竞品分析 / 定价 / 里程碑 / 验证计划。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';

type DbClient = Pool | PoolClient;

export type ProductPlanStatus = 'idea' | 'validating' | 'building' | 'launched' | 'archived';
export type ProductPlanSourceType = 'manual' | 'ai_inferred';

export const PRODUCT_PLAN_STATUSES: readonly ProductPlanStatus[] = [
  'idea',
  'validating',
  'building',
  'launched',
  'archived',
];

export function isProductPlanStatus(value: unknown): value is ProductPlanStatus {
  return typeof value === 'string' && (PRODUCT_PLAN_STATUSES as readonly string[]).includes(value);
}

export function isProductPlanSourceType(value: unknown): value is ProductPlanSourceType {
  return value === 'manual' || value === 'ai_inferred';
}

// ============================================================
// 产品计划流水线（闭环）：来源 → 文案 → 产品化分析 → 二创思路
// ============================================================

export type ProductPlanStepKey = 'source' | 'transcript' | 'analysis' | 'remix';
export type ProductPlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface ProductPlanStep {
  status: ProductPlanStepStatus;
  /** 最近一次状态更新时间（ISO）。 */
  at?: string;
  /** 说明/失败原因。 */
  note?: string;
}

export type ProductPlanPipeline = Record<ProductPlanStepKey, ProductPlanStep>;

export const PRODUCT_PLAN_STEP_KEYS: readonly ProductPlanStepKey[] = [
  'source',
  'transcript',
  'analysis',
  'remix',
];

/** 空流水线（各步 pending）。 */
export function emptyPipeline(): ProductPlanPipeline {
  return {
    source: { status: 'pending' },
    transcript: { status: 'pending' },
    analysis: { status: 'pending' },
    remix: { status: 'pending' },
  };
}

/** 容错归一化：库里的 jsonb（可能缺步/脏数据）→ 完整四步结构。 */
export function normalizePipeline(raw: unknown): ProductPlanPipeline {
  const base = emptyPipeline();
  if (!raw || typeof raw !== 'object') return base;
  const record = raw as Record<string, unknown>;
  for (const key of PRODUCT_PLAN_STEP_KEYS) {
    const value = record[key];
    if (value && typeof value === 'object' && typeof (value as ProductPlanStep).status === 'string') {
      base[key] = value as ProductPlanStep;
    }
  }
  return base;
}

/** 扫描候选来源方向 key（治理 v2 内置「搞钱」方向）。 */
export const PRODUCT_PLAN_SOURCE_DIRECTION = 'money';

export interface ProductPlanRow {
  id: string;
  userId: string;
  title: string;
  oneLiner: string;
  productDesc: string;
  targetUsers: string;
  approach: string;
  businessModel: string;
  risks: string;
  competitors: string;
  pricing: string;
  milestones: string;
  validationPlan: string;
  direction: string;
  remixIdeas: string;
  pipeline: ProductPlanPipeline;
  status: ProductPlanStatus;
  sourceType: ProductPlanSourceType;
  sourceArticleId: string | null;
  sourceUrl: string | null;
  sourceNote: string | null;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

const PLAN_SELECT_SQL = `
  id::text as "id",
  user_id::text as "userId",
  title,
  one_liner as "oneLiner",
  product_desc as "productDesc",
  target_users as "targetUsers",
  approach,
  business_model as "businessModel",
  risks,
  competitors,
  pricing,
  milestones,
  validation_plan as "validationPlan",
  direction,
  remix_ideas as "remixIdeas",
  pipeline,
  status,
  source_type as "sourceType",
  source_article_id::text as "sourceArticleId",
  source_url as "sourceUrl",
  source_note as "sourceNote",
  ai_generated as "aiGenerated",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

export interface ListProductPlansInput {
  userId?: string;
  status?: ProductPlanStatus;
  sourceType?: ProductPlanSourceType;
  keyword?: string;
  limit?: number;
  offset?: number;
}

export async function listProductPlans(
  db: DbClient,
  input: ListProductPlansInput = {},
): Promise<{ items: ProductPlanRow[]; total: number }> {
  const scopedUserId = normalizeUserId(input.userId);
  const limit = Math.max(1, Math.min(100, Math.round(input.limit ?? 50)));
  const offset = Math.max(0, Math.round(input.offset ?? 0));

  const conditions = ['user_id = $1'];
  const values: Array<string | number> = [scopedUserId];
  let paramIndex = 2;

  if (input.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }
  if (input.sourceType) {
    conditions.push(`source_type = $${paramIndex++}`);
    values.push(input.sourceType);
  }
  if (input.keyword?.trim()) {
    conditions.push(
      `(title ilike '%' || $${paramIndex} || '%' or one_liner ilike '%' || $${paramIndex} || '%')`,
    );
    paramIndex += 1;
    values.push(input.keyword.trim());
  }
  const whereSql = conditions.join(' and ');

  const { rows: countRows } = await db.query<{ count: number }>(
    `select count(*)::int as count from product_plans where ${whereSql}`,
    values,
  );

  const { rows } = await db.query(
    `
      select ${PLAN_SELECT_SQL}
      from product_plans
      where ${whereSql}
      order by updated_at desc, id desc
      limit $${paramIndex++} offset $${paramIndex++}
    `,
    [...values, limit, offset],
  );

  return { items: rows as ProductPlanRow[], total: countRows[0]?.count ?? 0 };
}

export async function getProductPlan(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<ProductPlanRow | null> {
  const { rows } = await db.query(
    `select ${PLAN_SELECT_SQL} from product_plans where id = $1 and user_id = $2 limit 1`,
    [id, normalizeUserId(userId)],
  );
  return (rows[0] as ProductPlanRow | undefined) ?? null;
}

export interface CreateProductPlanInput {
  userId?: string;
  title: string;
  oneLiner?: string;
  productDesc?: string;
  targetUsers?: string;
  approach?: string;
  businessModel?: string;
  risks?: string;
  competitors?: string;
  pricing?: string;
  milestones?: string;
  validationPlan?: string;
  direction?: string;
  remixIdeas?: string;
  pipeline?: ProductPlanPipeline;
  status?: ProductPlanStatus;
  sourceType: ProductPlanSourceType;
  sourceArticleId?: string | null;
  sourceUrl?: string | null;
  sourceNote?: string | null;
  aiGenerated?: boolean;
}

export async function createProductPlan(
  db: DbClient,
  input: CreateProductPlanInput,
): Promise<ProductPlanRow> {
  const { rows } = await db.query(
    `
      insert into product_plans(
        user_id, title, one_liner, product_desc, target_users, approach,
        business_model, risks, competitors, pricing, milestones, validation_plan,
        direction, remix_ideas, pipeline,
        status, source_type, source_article_id, source_url, source_note, ai_generated
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      returning ${PLAN_SELECT_SQL}
    `,
    [
      normalizeUserId(input.userId),
      input.title.slice(0, 200),
      input.oneLiner ?? '',
      input.productDesc ?? '',
      input.targetUsers ?? '',
      input.approach ?? '',
      input.businessModel ?? '',
      input.risks ?? '',
      input.competitors ?? '',
      input.pricing ?? '',
      input.milestones ?? '',
      input.validationPlan ?? '',
      input.direction ?? '',
      input.remixIdeas ?? '',
      JSON.stringify(input.pipeline ?? emptyPipeline()),
      input.status ?? 'idea',
      input.sourceType,
      input.sourceArticleId ?? null,
      input.sourceUrl ?? null,
      input.sourceNote ?? null,
      input.aiGenerated ?? false,
    ],
  );
  return rows[0] as ProductPlanRow;
}

export type UpdateProductPlanPatch = Partial<
  Pick<
    ProductPlanRow,
    | 'title'
    | 'oneLiner'
    | 'productDesc'
    | 'targetUsers'
    | 'approach'
    | 'businessModel'
    | 'risks'
    | 'competitors'
    | 'pricing'
    | 'milestones'
    | 'validationPlan'
    | 'direction'
    | 'remixIdeas'
    | 'pipeline'
    | 'status'
  >
>;

const UPDATE_COLUMN_BY_FIELD: Record<keyof UpdateProductPlanPatch, string> = {
  title: 'title',
  oneLiner: 'one_liner',
  productDesc: 'product_desc',
  targetUsers: 'target_users',
  approach: 'approach',
  businessModel: 'business_model',
  risks: 'risks',
  competitors: 'competitors',
  pricing: 'pricing',
  milestones: 'milestones',
  validationPlan: 'validation_plan',
  direction: 'direction',
  remixIdeas: 'remix_ideas',
  pipeline: 'pipeline',
  status: 'status',
};

export async function updateProductPlan(
  db: DbClient,
  id: string,
  patch: UpdateProductPlanPatch,
  userId?: string,
): Promise<ProductPlanRow | null> {
  const fields: string[] = [];
  const values: Array<string> = [id, normalizeUserId(userId)];
  let paramIndex = 3;

  for (const [field, column] of Object.entries(UPDATE_COLUMN_BY_FIELD) as Array<
    [keyof UpdateProductPlanPatch, string]
  >) {
    const value = patch[field];
    if (typeof value === 'undefined') continue;
    fields.push(`${column} = $${paramIndex++}`);
    if (field === 'pipeline') values.push(JSON.stringify(value));
    else if (field === 'title') values.push(String(value).slice(0, 200));
    else values.push(String(value));
  }
  if (fields.length === 0) return getProductPlan(db, id, userId);

  const { rows } = await db.query(
    `
      update product_plans
      set ${fields.join(', ')}, updated_at = now()
      where id = $1 and user_id = $2
      returning ${PLAN_SELECT_SQL}
    `,
    values,
  );
  return (rows[0] as ProductPlanRow | undefined) ?? null;
}

export async function deleteProductPlan(
  db: DbClient,
  id: string,
  userId?: string,
): Promise<boolean> {
  const { rowCount } = (await db.query(
    'delete from product_plans where id = $1 and user_id = $2',
    [id, normalizeUserId(userId)],
  )) as { rowCount?: number | null };
  return (rowCount ?? 0) > 0;
}

export interface ProductPlanStats {
  total: number;
  byStatus: Record<ProductPlanStatus, number>;
  manual: number;
  aiInferred: number;
}

export async function getProductPlanStats(
  db: DbClient,
  userId?: string,
): Promise<ProductPlanStats> {
  const { rows } = await db.query<{
    total: number;
    idea: number;
    validating: number;
    building: number;
    launched: number;
    archived: number;
    manual: number;
    aiInferred: number;
  }>(
    `
      select
        count(*)::int as total,
        count(*) filter (where status = 'idea')::int as idea,
        count(*) filter (where status = 'validating')::int as validating,
        count(*) filter (where status = 'building')::int as building,
        count(*) filter (where status = 'launched')::int as launched,
        count(*) filter (where status = 'archived')::int as archived,
        count(*) filter (where source_type = 'manual')::int as manual,
        count(*) filter (where source_type = 'ai_inferred')::int as "aiInferred"
      from product_plans
      where user_id = $1
    `,
    [normalizeUserId(userId)],
  );
  const row = rows[0];
  return {
    total: row?.total ?? 0,
    byStatus: {
      idea: row?.idea ?? 0,
      validating: row?.validating ?? 0,
      building: row?.building ?? 0,
      launched: row?.launched ?? 0,
      archived: row?.archived ?? 0,
    },
    manual: row?.manual ?? 0,
    aiInferred: row?.aiInferred ?? 0,
  };
}

export interface ProductPlanSourceArticle {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  link: string | null;
  directionKey: string | null;
}

/** 读取单篇文章作为产品计划生成来源。 */
export async function getProductPlanSourceArticle(
  db: DbClient,
  articleId: string,
  userId?: string,
): Promise<ProductPlanSourceArticle | null> {
  const { rows } = await db.query(
    `
      select
        a.id::text as "id",
        a.title,
        a.summary,
        coalesce(a.content_full_html, a.content_html) as "content",
        a.link,
        a.direction_key as "directionKey"
      from articles a
      where a.id = $1 and a.user_id = $2
      limit 1
    `,
    [articleId, normalizeUserId(userId)],
  );
  return (rows[0] as ProductPlanSourceArticle | undefined) ?? null;
}

/** 按来源链接查该用户的文章 id（人工想法含链接时自动挂真相源）。 */
export async function findArticleIdByLink(
  db: DbClient,
  link: string,
  userId?: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `
      select id::text as "id"
      from articles
      where user_id = $1 and link = $2
      order by id desc
      limit 1
    `,
    [normalizeUserId(userId), link],
  );
  return rows[0]?.id ?? null;
}

/** 按来源文章取计划（幂等判断用）。 */
export async function getProductPlanByArticle(
  db: DbClient,
  articleId: string,
  userId?: string,
): Promise<ProductPlanRow | null> {
  const { rows } = await db.query(
    `
      select ${PLAN_SELECT_SQL}
      from product_plans
      where user_id = $1 and source_article_id = $2
      order by id desc
      limit 1
    `,
    [normalizeUserId(userId), articleId],
  );
  return (rows[0] as ProductPlanRow | undefined) ?? null;
}

export async function hasProductPlanForArticle(
  db: DbClient,
  articleId: string,
  userId?: string,
): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    `
      select exists(
        select 1 from product_plans
        where user_id = $1 and source_article_id = $2
      ) as exists
    `,
    [normalizeUserId(userId), articleId],
  );
  return rows[0]?.exists ?? false;
}

/**
 * 扫描候选：指定方向（缺省「搞钱」）、已归档/已采用、且尚未生成过产品计划的文章。
 * 供定时批量扫描与手动「扫描搞钱内容」使用。
 */
export async function listProductPlanScanCandidates(
  db: DbClient,
  input: { userId?: string; directions?: string[]; limit?: number } = {},
): Promise<ProductPlanSourceArticle[]> {
  const scopedUserId = normalizeUserId(input.userId);
  const directions = input.directions?.length ? input.directions : [PRODUCT_PLAN_SOURCE_DIRECTION];
  const limit = Math.max(1, Math.min(50, Math.round(input.limit ?? 10)));

  const { rows } = await db.query(
    `
      select
        a.id::text as "id",
        a.title,
        a.summary,
        coalesce(a.content_full_html, a.content_html) as "content",
        a.link,
        a.direction_key as "directionKey"
      from articles a
      where a.user_id = $1
        and a.direction_key = any($2::text[])
        and a.governance_status in ('archived', 'used')
        and not exists (
          select 1 from product_plans p
          where p.user_id = a.user_id and p.source_article_id = a.id
        )
      order by a.quality_score desc nulls last, a.fetched_at desc nulls last, a.id desc
      limit $3
    `,
    [scopedUserId, directions, limit],
  );
  return rows as ProductPlanSourceArticle[];
}
