import { describe, expect, it } from 'vitest';
import {
  GOVERNANCE_STATUSES,
  assertTransition,
  canTransition,
  isGovernanceStatus,
  type GovernanceStatus,
} from '@/server/domains/governance/stateMachine';

// 合法迁移矩阵（计划 §3 Task 1）：
//   candidate → pending / archived / rejected
//   pending   → archived / rejected
//   archived  → used
//   rejected  → archived（restore）
//   used      → 终态
const LEGAL: Array<[GovernanceStatus, GovernanceStatus]> = [
  ['candidate', 'pending'],
  ['candidate', 'archived'],
  ['candidate', 'rejected'],
  ['pending', 'archived'],
  ['pending', 'rejected'],
  ['archived', 'used'],
  ['rejected', 'archived'],
];

describe('governance stateMachine', () => {
  it('覆盖 5×5 全迁移矩阵，仅合法迁移通过', () => {
    const legalSet = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
    for (const from of GOVERNANCE_STATUSES) {
      for (const to of GOVERNANCE_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(
          legalSet.has(`${from}->${to}`),
        );
      }
    }
  });

  it('used 是终态', () => {
    for (const to of GOVERNANCE_STATUSES) {
      expect(canTransition('used', to)).toBe(false);
    }
  });

  it('archived → candidate 非法（不可回到待批）', () => {
    expect(canTransition('archived', 'candidate')).toBe(false);
    expect(canTransition('archived', 'pending')).toBe(false);
    expect(canTransition('archived', 'rejected')).toBe(false);
  });

  it('assertTransition 对非法迁移抛错', () => {
    expect(() => assertTransition('candidate', 'used')).toThrow(/非法治理状态迁移/);
    expect(() => assertTransition('candidate', 'pending')).not.toThrow();
  });

  it('isGovernanceStatus 校验取值', () => {
    for (const status of GOVERNANCE_STATUSES) {
      expect(isGovernanceStatus(status)).toBe(true);
    }
    expect(isGovernanceStatus('draft')).toBe(false);
    expect(isGovernanceStatus('')).toBe(false);
    expect(isGovernanceStatus(null)).toBe(false);
    expect(isGovernanceStatus(42)).toBe(false);
  });
});
