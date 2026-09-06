/**
 * @deprecated P2e-3 起泛化为 sau/sauPublishService（douyin = platform 'douyin' 特例）。
 * 本文件仅保留旧名兼容（P2e-2 的调用方与测试），新代码请直接用 sau/。
 */
import type { Pool, PoolClient } from 'pg';
import {
  publishDraftVideoToSau,
  type SauVideoPublishDeps,
  type SauVideoPublishResult,
} from '@/core/platform-accounts/sau/sauPublishService';

type DbClient = Pool | PoolClient;

export interface DouyinPublishInput {
  draftId: string;
  accountId: string;
  videoPath?: string;
  videoUrl?: string;
  title?: string;
  tags?: string[];
  userId?: string;
}

export type DouyinPublishResult = SauVideoPublishResult;
export type DouyinPublishDeps = SauVideoPublishDeps;

export async function publishDraftToDouyin(
  db: DbClient,
  input: DouyinPublishInput,
  deps?: DouyinPublishDeps,
): Promise<DouyinPublishResult> {
  return publishDraftVideoToSau(db, { platform: 'douyin', ...input }, deps);
}
