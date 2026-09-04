'use client';

import { Brain, FolderOpen, Music2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  READER_PANE_ACTIVE_ITEM_CLASS_NAME,
  READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
} from '@/lib/ui/designSystem';

export type WorkbenchTab = 'workspace' | 'publish' | 'douyin' | 'knowledge';

export const WORKBENCH_TABS: Array<{ id: WorkbenchTab; name: string; Icon: typeof FolderOpen }> = [
  { id: 'workspace', name: '工作区', Icon: FolderOpen },
  { id: 'publish', name: '发布', Icon: Send },
  { id: 'douyin', name: '抖音数据', Icon: Music2 },
  { id: 'knowledge', name: '知识库', Icon: Brain },
];

interface WorkbenchMenuProps {
  activeTab: WorkbenchTab;
  onSelectTab: (tab: WorkbenchTab) => void;
}

/** 最左侧边栏「工作台」Tab 下的菜单目录：工作区 / 发布 / 抖音数据 */
export default function WorkbenchMenu({ activeTab, onSelectTab }: WorkbenchMenuProps) {
  return (
    <div className="space-y-0.5 px-2 py-2">
      {WORKBENCH_TABS.map((item) => {
        const active = item.id === activeTab;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectTab(item.id)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:border-white/[0.03]',
              active
                ? READER_PANE_ACTIVE_ITEM_CLASS_NAME
                : cn(
                    'text-foreground hover:text-accent-foreground',
                    READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
                  ),
            )}
          >
            <item.Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}
