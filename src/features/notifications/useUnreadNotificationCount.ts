'use client';

import { useEffect, useState } from 'react';
import { getUnreadNotificationCount } from '@/lib/api/apiClient';

export const NOTIFICATION_BADGE_POLL_MS = 30_000;

/** 消息中心未读数：30s 轮询 unread-count，静默失败（与 useGovernanceQueueSize 同模式）。 */
export function useUnreadNotificationCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await getUnreadNotificationCount({ notifyOnError: false });
        if (!cancelled) setCount(result.count);
      } catch {
        // 静默
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), NOTIFICATION_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return count;
}
