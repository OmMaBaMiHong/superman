/**
 * 存量方向回填（P2c 一次性工具）。
 *
 * 对 direction_key is null 的 archived 文章跑方向分类：
 *   - 默认只跑关键词派（零 AI 额度）；
 *   - withAi=true 时，关键词未命中的再送 AI 拟折分类（幻觉 key / 低置信落 general）。
 * 每批 200 条循环处理直到扫完；命中写入 direction_key/direction_reason
 * （带 [algo 版本] 前缀，可追溯）。防重入：同用户进行中直接 409。
 */
import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { ConflictError } from '@/server/infra/http/errors';
import {
  DIRECTION_AI_CONFIDENCE_THRESHOLD,
  FALLBACK_DIRECTION_KEY,
  classifyByKeywords,
  computeDirectionAlgoVersion,
  listDirectionStrategies,
} from '@/core/governance/directions';
import { draftGovernanceArticle } from '@/core/governance/aiDraft';
import type { AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';

type DbClient = Pool | PoolClient;

export const BACKFILL_BATCH_SIZE = 200;

/** 防重入：进程内按用户互斥（插件宿主/Next.js 都是单进程语义）。 */
const runningUsers = new Set<string>();

export interface BackfillResult {
  scanned: number;
  /** 被归到非兜底方向（关键词或 AI 命中）的条数。 */
  classified: number;
  batches: number;
}

interface BackfillRow {
  id: string;
  title: string;
  summary: string | null;
}

interface Assignment {
  id: string;
  directionKey: string;
  directionReason: string;
}

async function applyAssignments(
  db: DbClient,
  assignments: Assignment[],
  userId: string,
): Promise<void> {
  for (const item of assignments) {
    await db.query(
      `
        update articles
        set direction_key = $3,
            direction_reason = $4
        where id = $1
          and user_id = $2
          and direction_key is null
      `,
      [item.id, userId, item.directionKey, item.directionReason],
    );
  }
}

export interface BackfillDeps {
  draft?: typeof draftGovernanceArticle;
  /** 测试注入：覆盖批次大小。 */
  batchSize?: number;
}

export async function backfillDirections(
  db: DbClient,
  input: {
    userId?: string;
    /** 默认 false：只跑关键词，不花 AI 额度。 */
    withAi?: boolean;
    aiConfig?: AiRuntimeConfig | null;
  },
  deps?: BackfillDeps,
): Promise<BackfillResult> {
  const scopedUserId = normalizeUserId(input.userId);
  if (runningUsers.has(scopedUserId)) {
    throw new ConflictError('该用户的方向回填正在进行中，请稍后再试');
  }
  runningUsers.add(scopedUserId);
  try {
    const strategies = await listDirectionStrategies(db, { userId: scopedUserId, enabledOnly: true });
    const algoVersion = computeDirectionAlgoVersion(strategies);
    const batchSize = Math.max(1, Math.min(1000, Math.round(deps?.batchSize ?? BACKFILL_BATCH_SIZE)));
    const draftFn = deps?.draft ?? draftGovernanceArticle;
    const promptDirections = strategies.map((s) => ({ key: s.key, name: s.name, aiHint: s.aiHint }));
    const enabledKeys = new Set(strategies.map((s) => s.key));

    let scanned = 0;
    let classified = 0;
    let batches = 0;

    for (;;) {
      const { rows } = await db.query<BackfillRow>(
        `
          select
            id,
            title,
            summary
          from articles
          where user_id = $1
            and governance_status = 'archived'
            and direction_key is null
          order by id asc
          limit $2
        `,
        [scopedUserId, batchSize],
      );
      if (rows.length === 0) break;
      batches += 1;
      scanned += rows.length;

      const assignments: Assignment[] = [];
      for (const row of rows) {
        const keywordHit = classifyByKeywords(row.title, row.summary ?? '', strategies);
        if (keywordHit) {
          classified += 1;
          assignments.push({
            id: row.id,
            directionKey: keywordHit.directionKey,
            directionReason: `[algo ${algoVersion}] 回填：命中关键词「${keywordHit.matchedKeyword ?? ''}」`,
          });
          continue;
        }

        let assigned: Assignment | null = null;
        if (input.withAi && input.aiConfig) {
          const draft = await draftFn(
            {
              title: row.title,
              contentText: row.summary ?? '',
              directions: promptDirections,
            },
            input.aiConfig,
          );
          const key =
            draft.directionKey && enabledKeys.has(draft.directionKey) ? draft.directionKey : null;
          if (key && (draft.directionConfidence ?? 0) >= DIRECTION_AI_CONFIDENCE_THRESHOLD) {
            classified += 1;
            assigned = {
              id: row.id,
              directionKey: key,
              directionReason:
                `[algo ${algoVersion}] 回填：AI 分类（置信度 ${(draft.directionConfidence ?? 0).toFixed(2)}）` +
                (draft.directionReason ? `：${draft.directionReason}` : ''),
            };
          }
        }

        assignments.push(
          assigned ?? {
            id: row.id,
            directionKey: FALLBACK_DIRECTION_KEY,
            directionReason: `[algo ${algoVersion}] 回填：关键词未命中${input.withAi ? '且 AI 未给出可信方向' : ''}，归入「其他」`,
          },
        );
      }

      await applyAssignments(db, assignments, scopedUserId);
      if (rows.length < batchSize) break;
    }

    return { scanned, classified, batches };
  } finally {
    runningUsers.delete(scopedUserId);
  }
}

/** 测试钩子：清空防重入状态。 */
export function resetBackfillRunningStateForTest(): void {
  runningUsers.clear();
}
