'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Plus, Loader2 } from 'lucide-react';
import { useBoardStore } from '@/features/boards/hooks/useBoardStore';
import { getBoardItems } from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/hooks/useTranslation';

interface AddToBoardDialogProps {
  articleId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddToBoardDialog({ articleId, open, onOpenChange }: AddToBoardDialogProps) {
  const { t } = useTranslation('board');
  const { boards, loading, loadBoards, createBoard, addArticle, removeArticle } = useBoardStore();
  const [checkedBoardIds, setCheckedBoardIds] = React.useState<Set<string>>(new Set());
  const [loadingBoardIds, setLoadingBoardIds] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newBoardTitle, setNewBoardTitle] = React.useState('');

  // Load boards when dialog opens
  React.useEffect(() => {
    if (!open) return;

    const init = async () => {
      await loadBoards();
    };
    init();
  }, [open, loadBoards]);

  // Check which boards already contain the article
  React.useEffect(() => {
    if (!open || boards.length === 0) return;

    const checkBoards = async () => {
      setLoadingBoardIds(true);
      try {
        const results = await Promise.all(
          boards.map(async (board) => {
            const items = await getBoardItems(board.id);
            return {
              boardId: board.id,
              hasArticle: items.some((item) => item.articleId === articleId),
            };
          }),
        );
        setCheckedBoardIds(
          new Set(results.filter((r) => r.hasArticle).map((r) => r.boardId)),
        );
      } catch {
        // error handled by api client
      } finally {
        setLoadingBoardIds(false);
      }
    };
    checkBoards();
  }, [open, boards, articleId]);

  const handleToggle = async (boardId: string) => {
    const isChecked = checkedBoardIds.has(boardId);
    const newSet = new Set(checkedBoardIds);

    if (isChecked) {
      newSet.delete(boardId);
      setCheckedBoardIds(newSet);
      await removeArticle(boardId, articleId);
    } else {
      newSet.add(boardId);
      setCheckedBoardIds(newSet);
      await addArticle(boardId, articleId);
    }
  };

  const handleCreateBoard = async () => {
    const title = newBoardTitle.trim();
    if (!title) return;

    setCreating(true);
    try {
      const board = await createBoard(title);
      if (board) {
        setNewBoardTitle('');
        await addArticle(board.id, articleId);
        setCheckedBoardIds((prev) => new Set(prev).add(board.id));
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-sm translate-x-[-50%] translate-y-[-50%] gap-4 border border-border/70 bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 dark:border-white/[0.06] dark:bg-popover sm:rounded-2xl">
          <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
            {t('addToBoard')}
          </DialogPrimitive.Title>

          <div className="mt-4 max-h-60 overflow-y-auto">
            {loading || loadingBoardIds ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : boards.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t('noBoards')}
              </p>
            ) : (
              <ul className="space-y-1">
                {boards.map((board) => {
                  const isChecked = checkedBoardIds.has(board.id);
                  return (
                    <li key={board.id}>
                      <button
                        type="button"
                        onClick={() => handleToggle(board.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                          isChecked && 'bg-accent/60',
                        )}
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded border border-border">
                          {isChecked && (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          )}
                        </span>
                        <span className="text-base">{board.icon || '📋'}</span>
                        <span className="flex-1 truncate">{board.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-4 border-t border-border/70 pt-4">
            {creating ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newBoardTitle}
                  onChange={(e) => setNewBoardTitle(e.target.value)}
                  placeholder={t('boardNamePlaceholder')}
                  className="flex-1 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-sm outline-none focus:border-primary/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateBoard();
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleCreateBoard}
                  disabled={creating || !newBoardTitle.trim()}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('create')
                  )}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Plus className="h-4 w-4" />
                {t('createBoard')}
              </button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}