'use client';

import { useEffect, useState } from 'react';
import { listDirections, type DirectionTemplate } from '@/lib/api/apiClient';

let templatesPromise: Promise<DirectionTemplate[]> | null = null;

/** 方向模板表：模块级单例请求（多组件并发共享），失败置空不阻断。 */
function fetchTemplates(): Promise<DirectionTemplate[]> {
  if (!templatesPromise) {
    templatesPromise = listDirections({ notifyOnError: false })
      .then((result) => result.items)
      .catch(() => []);
  }
  return templatesPromise;
}

/** 方向模板映射（key → 模板）。P2b：徽章与筛选器共用。 */
export function useDirectionTemplates(): Map<string, DirectionTemplate> {
  const [templates, setTemplates] = useState<DirectionTemplate[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchTemplates().then((items) => {
      if (!cancelled) setTemplates(items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return new Map(templates.map((item) => [item.key, item]));
}
