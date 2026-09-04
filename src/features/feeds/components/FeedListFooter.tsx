import { Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
} from '@/lib/ui/designSystem';

interface FeedListFooterProps {
  onOpenSettings?: () => void;
}

export default function FeedListFooter({ onOpenSettings }: FeedListFooterProps) {
  if (!onOpenSettings) {
    return null;
  }

  return (
    <div className="shrink-0 border-t border-border/50 px-2 py-2 dark:border-white/[0.05]">
      <button
        type="button"
        onClick={onOpenSettings}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left text-sm font-medium transition-colors text-foreground hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:border-white/[0.03]',
          READER_PANE_HOVER_BACKGROUND_CLASS_NAME,
        )}
      >
        <Settings aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>设置</span>
      </button>
    </div>
  );
}