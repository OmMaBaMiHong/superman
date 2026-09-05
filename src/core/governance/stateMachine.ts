/**
 * 治理状态机（纯函数）。
 *
 * 状态流：candidate → pending → archived → used
 *          candidate/pending ↘ rejected →（restore）→ archived
 * used 为终态。全部非法迁移一律拒绝，由调用方（repository / API）转成 409。
 */
export type GovernanceStatus =
  | 'candidate'
  | 'pending'
  | 'archived'
  | 'rejected'
  | 'used';

export const GOVERNANCE_STATUSES: readonly GovernanceStatus[] = [
  'candidate',
  'pending',
  'archived',
  'rejected',
  'used',
];

const TRANSITIONS: Record<GovernanceStatus, readonly GovernanceStatus[]> = {
  candidate: ['pending', 'archived', 'rejected'],
  pending: ['archived', 'rejected'],
  archived: ['used'],
  rejected: ['archived'], // restore
  used: [],
};

export function isGovernanceStatus(value: unknown): value is GovernanceStatus {
  return (
    typeof value === 'string' &&
    (GOVERNANCE_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransition(from: GovernanceStatus, to: GovernanceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: GovernanceStatus, to: GovernanceStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法治理状态迁移: ${from} -> ${to}`);
  }
}
