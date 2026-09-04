'use client';

import { type DragEvent, useMemo, useState } from 'react';
import { Github, LayoutGrid, Rss } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/appStore';
import {
  READER_PANE_ACTIVE_ITEM_CLASS_NAME,
  READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
} from '@/lib/ui/designSystem';
import {
  GITHUB_VIEW_ID,
  PUBLISH_CENTER_VIEW_ID,
} from '@/lib/reader/view';
import { cn } from '@/lib/utils';
import {
  FEED_VIEW_TAB_ITEMS,
  type FeedViewTabCountMap,
  type FeedViewTabId,
} from './FeedViewTabs';

export type FeedRailTab = 'rss' | 'github' | 'workbench';

const RAIL_TABS: Array<{ id: FeedRailTab; name: string; Icon: typeof Rss }> = [
  { id: 'rss', name: 'RSS', Icon: Rss },
  { id: 'github', name: 'GitHub', Icon: Github },
  { id: 'workbench', name: '工作台', Icon: LayoutGrid },
];

/**
 * 二级列表：原顶部导航轨道的视图 Tab，去掉已提升到一级的「工作台」与「GitHub」。
 * 其余（总览 / 全部 / 发现 / 知识库 / 文章 / 社交 / 图片 / 视频 / 智能报告）全部展示为竖向列表。
 */
const SECONDARY_VIEW_TABS = FEED_VIEW_TAB_ITEMS.filter(
  (item) => item.id !== GITHUB_VIEW_ID && item.id !== PUBLISH_CENTER_VIEW_ID,
);

/** 把用户自定义顺序与默认顺序合并：用户顺序在前（仅保留合法 id），缺失的按默认顺序补在末尾。 */
function mergeOrder<T extends string>(custom: readonly string[], defaults: readonly T[]): T[] {
  const customValid = custom.filter((id): id is T => (defaults as readonly string[]).includes(id));
  const seen = new Set<string>();
  const merged = customValid.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const id of defaults) {
    if (!seen.has(id)) {
      merged.push(id);
      seen.add(id);
    }
  }
  return merged;
}

interface FeedRailTabsProps {
  activeRailTab: FeedRailTab;
  activeViewTabId: FeedViewTabId;
  viewTabCounts: FeedViewTabCountMap;
  unreadBadgeClassName: string;
  onSelectRailTab: (tab: FeedRailTab) => void;
  onSelectViewTab: (view: FeedViewTabId) => void;
}

/**
 * 最左侧边栏顶部导航：
 * - 一级轨道（来源）：RSS订阅 / GitHub RSS / 工作台（横向可拖拽排序，默认只展示图标+下方小字标签）；
 * - 二级列表（内容视图，仅 RSS 订阅时展示）：竖向列表一行一个（固定顺序），含未读 Badge。
 */
export default function FeedRailTabs({
  activeRailTab,
  activeViewTabId,
  viewTabCounts,
  unreadBadgeClassName,
  onSelectRailTab,
  onSelectViewTab,
}: FeedRailTabsProps) {
  const readerRailOrder = useAppStore((state) => state.readerRailOrder);
  const setReaderRailOrder = useAppStore((state) => state.setReaderRailOrder);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const railTabs = useMemo(
    () =>
      mergeOrder(readerRailOrder.level1, RAIL_TABS.map((item) => item.id)).map((id) => {
        const item = RAIL_TABS.find((tab) => tab.id === id);
        return item ?? { id, name: id, Icon: Rss };
      }),
    [readerRailOrder.level1],
  );

  // 二级视图固定顺序，不支持拖拽排序（用户明确要求）
  const secondaryViewTabs = SECONDARY_VIEW_TABS;

  const reorder = (fromId: string, toId: string, level: 'level1' | 'level2') => {
    if (fromId === toId || level !== 'level1') return;
    const current = mergeOrder(
      readerRailOrder[level],
      RAIL_TABS.map((item) => item.id),
    );
    const fromIndex = current.indexOf(fromId as never);
    const toIndex = current.indexOf(toId as never);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    setReaderRailOrder({ ...readerRailOrder, [level]: next });
  };

  const onDropOnRail = (event: DragEvent<HTMLButtonElement>, id: string) => {
    event.preventDefault();
    if (draggingId) {
      reorder(draggingId, id, 'level1');
    }
    setDraggingId(null);
    setOverId(null);
  };

  const renderRailTab = (item: (typeof railTabs)[number]) => {
    const active = item.id === activeRailTab;
    return (
      <button
        key={item.id}
        type="button"
        draggable
        onClick={() => onSelectRailTab(item.id)}
        onDragStart={() => setDraggingId(item.id)}
        onDragOver={(event) => {
          event.preventDefault();
          setOverId(item.id);
        }}
        onDragLeave={() => setOverId((current) => (current === item.id ? null : current))}
        onDrop={(event) => onDropOnRail(event, item.id)}
        onDragEnd={() => {
          setDraggingId(null);
          setOverId(null);
        }}
        aria-current={active ? 'true' : undefined}
        title={item.name}
        className={cn(
          'flex h-auto shrink-0 cursor-grab flex-col items-center gap-0.5 rounded-lg border border-transparent px-1 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing dark:border-white/[0.03]',
          overId === item.id && draggingId ? 'opacity-80 ring-1 ring-ring/60' : '',
          active
            ? READER_PANE_ACTIVE_ITEM_CLASS_NAME
            : cn(
                'text-muted-foreground hover:text-foreground',
                READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
              ),
        )}
      >
        <item.Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="max-w-full whitespace-nowrap leading-none">{item.name}</span>
      </button>
    );
  };

  const renderSecondaryTab = (item: (typeof secondaryViewTabs)[number]) => {
    const active = item.id === activeViewTabId;
    const count = viewTabCounts[item.id];
    return (
      <button
        key={item.id}
        type="button"
        role="tab"
        onClick={() => onSelectViewTab(item.id)}
        aria-selected={active ? 'true' : 'false'}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          active
            ? READER_PANE_ACTIVE_ITEM_CLASS_NAME
            : cn(
                'text-muted-foreground hover:text-foreground',
                READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
              ),
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <item.Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="truncate leading-none">{item.name}</span>
        </div>
        {count > 0 ? (
          <Badge
            variant="secondary"
            aria-hidden="true"
            className={cn(
              'h-5 min-w-6 shrink-0 justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
              unreadBadgeClassName,
            )}
          >
            {count}
          </Badge>
        ) : null}
      </button>
    );
  };

  return (
    <div className="space-y-2 px-2 pb-2 pt-1.5">
      {/* 一级轨道：来源（横向可拖拽） */}
      <div
        data-testid="feed-rail-level1"
        className="flex items-center gap-0.5 overflow-x-auto rounded-lg bg-muted/50 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {railTabs.map(renderRailTab)}
      </div>

      {/* 二级列表：RSS 下的内容视图（竖向列表，固定顺序，不用拖拽） */}
      {activeRailTab === 'rss' ? (
        <div
          data-testid="feed-rail-level2"
          role="tablist"
          aria-orientation="vertical"
          className="space-y-1"
        >
          {secondaryViewTabs.map(renderSecondaryTab)}
        </div>
      ) : null}
    </div>
  );
}
