import { AlertCircle, ArrowDown, ArrowUp, FileText, FolderTree, PencilLine, Power, Sparkles, Languages, Trash2 } from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemHint,
  ContextMenuItemIcon,
  ContextMenuItemLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Feed } from '../../../types';

interface FeedCategoryContextMenuProps {
  categoryId: string;
  categoryIndex: number;
  categoryMasterLength: number;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  children: ReactNode;
}

/** ContextMenu wrapper for a category trigger button. */
export function FeedCategoryContextMenu({
  categoryId,
  categoryIndex,
  categoryMasterLength,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  children,
}: FeedCategoryContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onSelect={onRename}>
          <ContextMenuItemIcon aria-hidden="true">
            <PencilLine className="h-3.5 w-3.5" />
          </ContextMenuItemIcon>
          <ContextMenuItemLabel>编辑</ContextMenuItemLabel>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={categoryIndex <= 0}
          onSelect={onMoveUp}
        >
          <ContextMenuItemIcon aria-hidden="true">
            <ArrowUp className="h-3.5 w-3.5" />
          </ContextMenuItemIcon>
          <ContextMenuItemLabel>上移</ContextMenuItemLabel>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={categoryIndex < 0 || categoryIndex >= categoryMasterLength - 1}
          onSelect={onMoveDown}
        >
          <ContextMenuItemIcon aria-hidden="true">
            <ArrowDown className="h-3.5 w-3.5" />
          </ContextMenuItemIcon>
          <ContextMenuItemLabel>下移</ContextMenuItemLabel>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <ContextMenuItemIcon aria-hidden="true" className="text-current">
            <Trash2 className="h-3.5 w-3.5" />
          </ContextMenuItemIcon>
          <ContextMenuItemLabel>删除</ContextMenuItemLabel>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface FeedItemContextMenuProps {
  feed: Feed;
  categoryMaster: { id: string; name: string }[];
  uncategorizedName: string;
  showFilteredArticles: boolean;
  isRssFeed: boolean;
  showTextAutomationPolicies: boolean;
  hoveredFeedErrorId: string | null;
  onHoveredFeedErrorChange: Dispatch<SetStateAction<string | null>>;
  onEdit: () => void;
  onMoveToCategory: (categoryId: string | null, categoryName: string) => void;
  onToggleFiltered: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onFulltextPolicy: () => void;
  onSummaryPolicy: () => void;
  onTranslationPolicy: () => void;
  children: ReactNode;
}

/** ContextMenu wrapper for a feed item button. */
export function FeedItemContextMenu({
  feed,
  categoryMaster,
  uncategorizedName,
  showFilteredArticles,
  isRssFeed,
  showTextAutomationPolicies,
  hoveredFeedErrorId,
  onHoveredFeedErrorChange,
  onEdit,
  onMoveToCategory,
  onToggleFiltered,
  onToggleEnabled,
  onDelete,
  onFulltextPolicy,
  onSummaryPolicy,
  onTranslationPolicy,
  children,
}: FeedItemContextMenuProps) {
  const fetchErrorText = feed.fetchRawError || feed.fetchError;
  const isFeedErrored = Boolean(fetchErrorText);
  const errorDescriptionId = `feed-error-${feed.id}`;

  const trigger = isFeedErrored ? (
    <span className="block">
      <TooltipProvider delayDuration={150}>
        <Tooltip open={hoveredFeedErrorId === feed.id}>
          <TooltipTrigger asChild>{children}</TooltipTrigger>
          <TooltipContent side="right" className="max-w-64 whitespace-normal">
            <div className="space-y-1">
              <p className="font-medium">更新失败</p>
              <p>{fetchErrorText}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  ) : (
    children
  );

  return (
    <ContextMenu>
      {isFeedErrored ? <span id={errorDescriptionId} className="sr-only">最近更新失败：{fetchErrorText}</span> : null}
      <ContextMenuTrigger asChild>
        {trigger}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={onEdit}>
          <ContextMenuItemIcon aria-hidden="true">
            <PencilLine className="h-3.5 w-3.5" />
          </ContextMenuItemIcon>
          <ContextMenuItemLabel>编辑</ContextMenuItemLabel>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {feed.provider !== 'fever' ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ContextMenuItemIcon aria-hidden="true">
                <FolderTree className="h-3.5 w-3.5" />
              </ContextMenuItemIcon>
              <ContextMenuItemLabel>移动到分类</ContextMenuItemLabel>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              {categoryMaster.map((category) => {
                const isCurrentCategory = feed.categoryId === category.id;

                return (
                  <ContextMenuItem
                    key={category.id}
                    disabled={isCurrentCategory}
                    onSelect={() => onMoveToCategory(category.id, category.name)}
                  >
                    <ContextMenuItemIcon
                      aria-hidden="true"
                      className={cn(isCurrentCategory && 'text-primary')}
                    >
                      <FolderTree className="h-3.5 w-3.5" />
                    </ContextMenuItemIcon>
                    <ContextMenuItemLabel>{category.name}</ContextMenuItemLabel>
                    {isCurrentCategory ? (
                      <ContextMenuItemHint
                        aria-hidden="true"
                        className="border-primary/20 bg-primary/10 text-primary"
                      >
                        当前
                      </ContextMenuItemHint>
                    ) : null}
                  </ContextMenuItem>
                );
              })}
              <ContextMenuItem
                disabled={!feed.categoryId}
                onSelect={() => onMoveToCategory(null, uncategorizedName)}
              >
                <ContextMenuItemIcon
                  aria-hidden="true"
                  className={cn(!feed.categoryId && 'text-primary')}
                >
                  <FolderTree className="h-3.5 w-3.5" />
                </ContextMenuItemIcon>
                <ContextMenuItemLabel>{uncategorizedName}</ContextMenuItemLabel>
                {!feed.categoryId ? (
                  <ContextMenuItemHint
                    aria-hidden="true"
                    className="border-primary/20 bg-primary/10 text-primary"
                  >
                    当前
                  </ContextMenuItemHint>
                ) : null}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}
        {isRssFeed ? (
          <>
            <ContextMenuSeparator />
            {showTextAutomationPolicies ? (
              <>
                <ContextMenuItem onSelect={onFulltextPolicy}>
                  <ContextMenuItemIcon aria-hidden="true">
                    <FileText className="h-3.5 w-3.5" />
                  </ContextMenuItemIcon>
                  <ContextMenuItemLabel>全文抓取配置</ContextMenuItemLabel>
                </ContextMenuItem>
                <ContextMenuItem onSelect={onSummaryPolicy}>
                  <ContextMenuItemIcon aria-hidden="true">
                    <Sparkles className="h-3.5 w-3.5" />
                  </ContextMenuItemIcon>
                  <ContextMenuItemLabel>AI摘要配置</ContextMenuItemLabel>
                </ContextMenuItem>
                <ContextMenuItem onSelect={onTranslationPolicy}>
                  <ContextMenuItemIcon aria-hidden="true">
                    <Languages className="h-3.5 w-3.5" />
                  </ContextMenuItemIcon>
                  <ContextMenuItemLabel>翻译配置</ContextMenuItemLabel>
                </ContextMenuItem>
              </>
            ) : null}
            <ContextMenuItem onSelect={onToggleFiltered}>
              <ContextMenuItemIcon aria-hidden="true">
                <AlertCircle className="h-3.5 w-3.5" />
              </ContextMenuItemIcon>
              <ContextMenuItemLabel>
                {showFilteredArticles ? '隐藏已过滤文章' : '查看已过滤文章'}
              </ContextMenuItemLabel>
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onToggleEnabled}>
          <ContextMenuItemIcon aria-hidden="true">
            <Power className="h-3.5 w-3.5" />
          </ContextMenuItemIcon>
          <ContextMenuItemLabel>{feed.enabled ? '停用' : '启用'}</ContextMenuItemLabel>
        </ContextMenuItem>
        {feed.provider !== 'fever' ? (
          <ContextMenuItem
            variant="destructive"
            onSelect={onDelete}
          >
            <ContextMenuItemIcon aria-hidden="true" className="text-current">
              <Trash2 className="h-3.5 w-3.5" />
            </ContextMenuItemIcon>
            <ContextMenuItemLabel>删除</ContextMenuItemLabel>
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}