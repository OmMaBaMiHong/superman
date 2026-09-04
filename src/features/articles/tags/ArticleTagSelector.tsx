'use client';

import { useEffect, useState } from 'react';
import { Check, Plus, Tag as TagIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { useTagStore } from './hooks/useTagStore';

const TAG_COLORS = ['gray', 'red', 'blue', 'green', 'yellow'] as const;

const TAG_COLOR_HEX: Record<string, string> = {
  gray: 'var(--color-muted-foreground)',
  red: 'var(--color-error)',
  blue: 'var(--color-info)',
  green: 'var(--color-success)',
  yellow: 'var(--color-warning)',
};

function resolveTagColor(color: string | null | undefined): string {
  if (!color) return TAG_COLOR_HEX.gray;
  return TAG_COLOR_HEX[color] ?? color;
}

interface ArticleTagSelectorProps {
  articleId: number;
}

export function ArticleTagSelector({ articleId }: ArticleTagSelectorProps) {
  const { t } = useTranslation();
  const {
    tags,
    articleTags,
    loading,
    loadTags,
    loadArticleTags,
    addTag,
    attachTags,
    detachTag,
  } = useTagStore();
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState('gray');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadTags();
    void loadArticleTags(articleId);
  }, [open, articleId, loadTags, loadArticleTags]);

  const articleTagIds = new Set(articleTags.map((tag) => tag.id));

  const handleToggle = (tagId: string, checked: boolean) => {
    if (checked) {
      void detachTag(articleId, tagId);
    } else {
      void attachTags(articleId, [tagId]);
    }
  };

  const handleCreate = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const tag = await addTag(name, selectedColor);
    if (tag) {
      await attachTags(articleId, [tag.id]);
      setNewTagName('');
      setSelectedColor('gray');
    }
  };

  const showEmpty = tags.length === 0 && !loading;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <TagIcon className="h-4 w-4" />
          <span>{t('article.tag.title')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="border-b border-border/70 p-3">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <TagIcon className="h-4 w-4" />
            {t('article.tag.title')}
          </h4>
        </div>

        <div className="max-h-60 overflow-y-auto p-1">
          {showEmpty ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t('article.tag.noTags')}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {tags.map((tag) => {
                const checked = articleTagIds.has(tag.id);
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => handleToggle(tag.id, checked)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        'hover:bg-accent/80 hover:text-accent-foreground',
                        checked && 'bg-accent/60 text-accent-foreground',
                      )}
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: resolveTagColor(tag.color) }}
                      />
                      <span className="flex-1 truncate">{tag.name}</span>
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input',
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border/70 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Input
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder={t('article.tag.create')}
              className="h-8"
            />
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => void handleCreate()}
              disabled={!newTagName.trim()}
              className="shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setSelectedColor(color)}
                className={cn(
                  'h-5 w-5 rounded-full transition-transform',
                  selectedColor === color &&
                    'scale-110 ring-2 ring-offset-1 ring-offset-background ring-primary',
                )}
                style={{ backgroundColor: TAG_COLOR_HEX[color] }}
                aria-label={color}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ArticleTagSelector;