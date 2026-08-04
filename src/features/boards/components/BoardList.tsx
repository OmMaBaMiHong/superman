'use client';

import * as React from 'react';
import { LayoutDashboard, Plus, Loader2 } from 'lucide-react';
import { useBoardStore } from '@/features/boards/hooks/useBoardStore';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/hooks/useTranslation';

export function BoardList() {
  const { t } = useTranslation('board');
  const { boards, loading, activeBoardId, setActiveBoard, loadBoards, createBoard } =
    useBoardStore();
  const [creating, setCreating] = React.useState(false);
  const [newBoardTitle, setNewBoardTitle] = React.useState('');

  React.useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  const handleCreateBoard = async () => {
    const title = newBoardTitle.trim();
    if (!title) return;
    setCreating(true);

    try {
      const board = await createBoard(title);
      if (board) {
        setNewBoardTitle('');
        setActiveBoard(board.id);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-2 flex items-center gap-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <LayoutDashboard className="h-3.5 w-3.5" />
        <span>{t('myBoards')}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : boards.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">{t('noBoards')}</p>
      ) : (
        <ul className="space-y-0.5">
          {boards.map((board) => (
            <li key={board.id}>
              <button
                type="button"
                onClick={() => setActiveBoard(board.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                  activeBoardId === board.id &&
                    'bg-accent font-medium text-accent-foreground',
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center text-base">
                  {board.icon || '📋'}
                </span>
                <span className="flex-1 truncate">{board.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-border/70 pt-2">
        {creating ? (
          <div className="flex items-center gap-2 px-3">
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
                if (e.key === 'Escape') {
                  setCreating(false);
                  setNewBoardTitle('');
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
    </div>
  );
}