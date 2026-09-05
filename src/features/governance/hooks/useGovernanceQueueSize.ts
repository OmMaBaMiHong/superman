'use client';

import { useEffect, useState } from 'react';
import { getGovernanceStats } from '@/lib/api/apiClient';

export const GOVERNANCE_BADGE_POLL_MS = 30_000;

/** 审批台待批数：轮询 /api/governance/stats，静默失败（未登录/网络异常时徽章不显示）。 */
export function useGovernanceQueueSize(): number {
  const [queueSize, setQueueSize] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const stats = await getGovernanceStats({ notifyOnError: false });
        if (!cancelled) setQueueSize(stats.queueSize);
      } catch {
        // 静默
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), GOVERNANCE_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return queueSize;
}
