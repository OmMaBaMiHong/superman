/**
 * 审批动作服务：approve / reject / redraft / restore。
 * 状态合法性由 stateMachine.canTransition 保证，repo 返回判别联合，
 * 这里统一翻译成 HTTP 错误（404 / 409），路由保持薄壳。
 */
import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '@/server/infra/http/errors';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';
import { stripHtmlToText } from '@/lib/reader/articleSummary';
import {
  draftGovernanceArticle,
  type GovernanceDraft,
} from '@/server/domains/governance/aiDraft';
import {
  getGovernanceItem,
  insertRejectLog,
  transitionGovernanceStatus,
  type GovernanceItemRow,
} from '@/server/domains/governance/repository';
import type { GovernanceStatus } from '@/server/domains/governance/stateMachine';

type DbClient = Pool | PoolClient;

async function transitionOrThrow(
  db: DbClient,
  input: Parameters<typeof transitionGovernanceStatus>[1],
): Promise<GovernanceItemRow> {
  const result = await transitionGovernanceStatus(db, input);
  if (result.ok) return result.item;
  if (result.reason === 'not_found') {
    throw new NotFoundError('治理条目不存在');
  }
  throw new ConflictError(
    `当前状态（${result.currentStatus}）不允许迁移到 ${input.to}`,
    { status: result.currentStatus },
  );
}

export async function approveGovernanceItem(
  db: DbClient,
  input: { id: string; userId?: string },
): Promise<GovernanceItemRow> {
  return transitionOrThrow(db, { id: input.id, userId: input.userId, to: 'archived' });
}

export async function rejectGovernanceItem(
  db: DbClient,
  input: { id: string; reason: string; userId?: string },
): Promise<GovernanceItemRow> {
  const item = await getGovernanceItem(db, input.id, input.userId);
  if (!item) throw new NotFoundError('治理条目不存在');

  const updated = await transitionOrThrow(db, {
    id: input.id,
    userId: input.userId,
    to: 'rejected',
  });
  // 驳回记忆：原标题 + 来源 URL 参与 7 天去重。
  await insertRejectLog(db, {
    userId: input.userId,
    articleId: item.id,
    reason: input.reason,
    title: item.titleOriginal ?? item.title,
    sourceUrl: item.link,
  });
  return updated;
}

export async function restoreGovernanceItem(
  db: DbClient,
  input: { id: string; userId?: string },
): Promise<GovernanceItemRow> {
  return transitionOrThrow(db, { id: input.id, userId: input.userId, to: 'archived' });
}

export interface RedraftGovernanceItemResult {
  item: GovernanceItemRow;
  draft: GovernanceDraft;
}

export async function redraftGovernanceItem(
  db: DbClient,
  input: { id: string; reason: string; userId?: string },
  deps?: { draft?: typeof draftGovernanceArticle },
): Promise<RedraftGovernanceItemResult> {
  const item = await getGovernanceItem(db, input.id, input.userId);
  if (!item) throw new NotFoundError('治理条目不存在');

  const allowedFrom: GovernanceStatus[] = ['candidate', 'pending'];
  if (!allowedFrom.includes(item.governanceStatus)) {
    throw new ConflictError(
      `当前状态（${item.governanceStatus}）不允许打回重拟`,
      { status: item.governanceStatus },
    );
  }

  // AI 配置缺失或调用失败时 draftGovernanceArticle 内部回退，不阻塞重拟。
  const uiSettings = normalizePersistedSettings(await getUiSettings(db, input.userId));
  const aiApiKey = await getAiApiKey(db, input.userId);
  const aiConfig = resolveSharedAiConfig({
    settings: { ai: uiSettings.ai },
    aiApiKey,
  });

  const draftFn = deps?.draft ?? draftGovernanceArticle;
  const draft = await draftFn(
    {
      title: item.title,
      contentText: stripHtmlToText(item.contentHtml ?? ''),
      sourceUrl: item.link,
      redraftReason: input.reason,
      previousSummary: item.summary,
      previousQualityScore: item.qualityScore,
    },
    aiConfig,
  );

  const updated = await transitionOrThrow(db, {
    id: input.id,
    userId: input.userId,
    to: 'pending',
    patch: {
      title: draft.title,
      summary: draft.summary,
      aiReason: draft.aiReason,
      qualityScore: draft.qualityScore,
      incrementRedraftCount: true,
    },
  });
  return { item: updated, draft };
}
