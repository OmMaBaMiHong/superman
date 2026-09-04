import { Compass, Github, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface FeedListHeaderProps {
  reserveCloseButtonSpace: boolean;
  addMenuOpen: boolean;
  onAddMenuOpenChange: (open: boolean) => void;
  onAddFeed: () => void;
  onAddAiDigest: () => void;
  onOpenDiscover: () => void;
  onAddGithub?: () => void;
}

export default function FeedListHeader({
  reserveCloseButtonSpace,
  addMenuOpen,
  onAddMenuOpenChange,
  onAddFeed,
  onAddAiDigest,
  onOpenDiscover,
  onAddGithub,
}: FeedListHeaderProps) {
  return (
    <div
      data-testid="feed-list-header"
      className={cn(
        'flex h-12 items-center justify-between border-b border-transparent px-4 dark:border-white/[0.04]',
        reserveCloseButtonSpace && 'pr-16',
      )}
    >
      <h1 className="flex items-center gap-2">
        <img
          src="/feedfuse-logo.svg"
          alt="FeedFuse"
          width={28}
          height={28}
          className="h-7 w-7 shrink-0"
        />
        <span className="text-[15px] font-semibold leading-none tracking-tight dark:bg-gradient-to-b dark:from-white dark:via-white/95 dark:to-white/72 dark:bg-clip-text dark:text-transparent">
          FeedFuse
        </span>
      </h1>
      <Popover open={addMenuOpen} onOpenChange={onAddMenuOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground dark:border dark:border-white/[0.04] dark:bg-card/92"
            aria-label="添加订阅"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        {/* 固定添加菜单从 + 按钮下方弹出，并保持左边缘对齐 */}
        <PopoverContent side="bottom" align="start" sideOffset={8} className="w-44 p-1">
          <div className="flex flex-col gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start"
              onClick={() => {
                onAddMenuOpenChange(false);
                onAddFeed();
              }}
            >
              添加 RSS 源
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start"
              onClick={() => {
                onAddMenuOpenChange(false);
                onAddAiDigest();
              }}
            >
              添加智能报告
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start"
              onClick={() => {
                onAddMenuOpenChange(false);
                onOpenDiscover();
              }}
            >
              <Compass className="mr-2 h-3.5 w-3.5" />
              发现
            </Button>
            {onAddGithub ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start"
                onClick={() => {
                  onAddMenuOpenChange(false);
                  onAddGithub();
                }}
              >
                <Github className="mr-2 h-3.5 w-3.5" />
                添加 GitHub 仓库
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}