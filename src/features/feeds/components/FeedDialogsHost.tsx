import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { Category, Feed } from '../../../types';

const AddFeedDialog = dynamic(() => import('./AddFeedDialog'), { ssr: false, loading: () => null });
const AddAiDigestDialog = dynamic(() => import('./AddAiDigestDialog'), { ssr: false, loading: () => null });
const EditFeedDialog = dynamic(() => import('./EditFeedDialog'), { ssr: false, loading: () => null });
const EditAiDigestDialog = dynamic(() => import('./EditAiDigestDialog'), { ssr: false, loading: () => null });
const FeedFulltextPolicyDialog = dynamic(() => import('./FeedFulltextPolicyDialog'), {
  ssr: false,
  loading: () => null,
});
const FeedSummaryPolicyDialog = dynamic(() => import('./FeedSummaryPolicyDialog'), {
  ssr: false,
  loading: () => null,
});
const FeedTranslationPolicyDialog = dynamic(() => import('./FeedTranslationPolicyDialog'), {
  ssr: false,
  loading: () => null,
});
const RenameCategoryDialog = dynamic(() => import('./RenameCategoryDialog'), {
  ssr: false,
  loading: () => null,
});

interface FeedDialogsHostProps {
  categoryMaster: Category[];
  feeds: Feed[];

  // Add Feed
  addFeedOpen: boolean;
  onAddFeedOpenChange: (open: boolean) => void;
  presetFeedUrl: string | null;
  presetFeedTitle: string | null;
  onAddFeed: (payload: any) => Promise<void>;

  // Add AI Digest
  addAiDigestOpen: boolean;
  onAddAiDigestOpenChange: (open: boolean) => void;

  // Edit Feed (raw IDs)
  editFeedId: string | null;
  onEditFeedClose: () => void;
  onEditFeedSubmit: (payload: any) => Promise<void>;

  // Edit AI Digest (raw IDs)
  editAiDigestFeedId: string | null;
  onEditAiDigestClose: () => void;

  // Rename Category
  activeRenameCategory: { id: string; name: string } | null;
  onRenameCategoryClose: () => void;
  onRenameCategorySubmit: (name: string) => Promise<void>;

  // Summary Policy (raw IDs)
  summaryPolicyFeedId: string | null;
  onSummaryPolicyClose: () => void;
  onSummaryPolicySubmit: (patch: any) => Promise<void>;

  // Fulltext Policy (raw IDs)
  fulltextPolicyFeedId: string | null;
  onFulltextPolicyClose: () => void;
  onFulltextPolicySubmit: (patch: any) => Promise<void>;

  // Translation Policy (raw IDs)
  translationPolicyFeedId: string | null;
  onTranslationPolicyClose: () => void;
  onTranslationPolicySubmit: (patch: any) => Promise<void>;

  // Delete Feed (raw IDs)
  deleteFeedId: string | null;
  onDeleteFeedClose: () => void;
  onDeleteFeedConfirm: () => void;

  // Delete Category (raw IDs)
  deleteCategoryId: string | null;
  onDeleteCategoryClose: () => void;
  onDeleteCategoryConfirm: () => void;
}

export default function FeedDialogsHost({
  categoryMaster,
  feeds,
  addFeedOpen,
  onAddFeedOpenChange,
  presetFeedUrl,
  presetFeedTitle,
  onAddFeed,
  addAiDigestOpen,
  onAddAiDigestOpenChange,
  editFeedId,
  onEditFeedClose,
  onEditFeedSubmit,
  editAiDigestFeedId,
  onEditAiDigestClose,
  activeRenameCategory,
  onRenameCategoryClose,
  onRenameCategorySubmit,
  summaryPolicyFeedId,
  onSummaryPolicyClose,
  onSummaryPolicySubmit,
  fulltextPolicyFeedId,
  onFulltextPolicyClose,
  onFulltextPolicySubmit,
  translationPolicyFeedId,
  onTranslationPolicyClose,
  onTranslationPolicySubmit,
  deleteFeedId,
  onDeleteFeedClose,
  onDeleteFeedConfirm,
  deleteCategoryId,
  onDeleteCategoryClose,
  onDeleteCategoryConfirm,
}: FeedDialogsHostProps) {
  const activeEditFeed = useMemo(
    () => (editFeedId ? feeds.find((feed) => feed.id === editFeedId) ?? null : null),
    [editFeedId, feeds],
  );
  const activeEditAiDigestFeed = useMemo(
    () =>
      editAiDigestFeedId
        ? feeds.find((feed) => feed.id === editAiDigestFeedId && (feed.kind ?? 'rss') === 'ai_digest') ?? null
        : null,
    [editAiDigestFeedId, feeds],
  );
  const activeDeleteFeed = useMemo(
    () => (deleteFeedId ? feeds.find((feed) => feed.id === deleteFeedId) ?? null : null),
    [deleteFeedId, feeds],
  );
  const activeDeleteCategory = useMemo(
    () => (deleteCategoryId ? categoryMaster.find((category) => category.id === deleteCategoryId) ?? null : null),
    [categoryMaster, deleteCategoryId],
  );
  const activeFulltextPolicyFeed = useMemo(
    () => (fulltextPolicyFeedId ? feeds.find((feed) => feed.id === fulltextPolicyFeedId) ?? null : null),
    [fulltextPolicyFeedId, feeds],
  );
  const activeSummaryPolicyFeed = useMemo(
    () => (summaryPolicyFeedId ? feeds.find((feed) => feed.id === summaryPolicyFeedId) ?? null : null),
    [summaryPolicyFeedId, feeds],
  );
  const activeTranslationPolicyFeed = useMemo(
    () =>
      translationPolicyFeedId ? feeds.find((feed) => feed.id === translationPolicyFeedId) ?? null : null,
    [translationPolicyFeedId, feeds],
  );

  return (
    <>
      {addFeedOpen ? (
        <AddFeedDialog
          open
          onOpenChange={onAddFeedOpenChange}
          categories={categoryMaster}
          presetUrl={presetFeedUrl ?? undefined}
          presetTitle={presetFeedTitle ?? undefined}
          onSubmit={onAddFeed}
        />
      ) : null}
      {addAiDigestOpen ? (
        <AddAiDigestDialog
          open
          onOpenChange={onAddAiDigestOpenChange}
          categories={categoryMaster}
          feeds={feeds}
        />
      ) : null}

      {activeEditFeed ? (
        <EditFeedDialog
          open
          feed={activeEditFeed}
          categories={categoryMaster}
          onOpenChange={(open) => {
            if (!open) {
              onEditFeedClose();
            }
          }}
          onSubmit={onEditFeedSubmit}
        />
      ) : null}

      {activeEditAiDigestFeed ? (
        <EditAiDigestDialog
          open
          feed={activeEditAiDigestFeed}
          categories={categoryMaster}
          feeds={feeds}
          onOpenChange={(open) => {
            if (!open) {
              onEditAiDigestClose();
            }
          }}
        />
      ) : null}

      <RenameCategoryDialog
        open={Boolean(activeRenameCategory)}
        category={activeRenameCategory}
        onOpenChange={(open) => {
          if (!open) {
            onRenameCategoryClose();
          }
        }}
        onSubmit={onRenameCategorySubmit}
      />

      <FeedSummaryPolicyDialog
        open={Boolean(activeSummaryPolicyFeed)}
        feed={activeSummaryPolicyFeed}
        onOpenChange={(open) => {
          if (!open) {
            onSummaryPolicyClose();
          }
        }}
        onSubmit={onSummaryPolicySubmit}
      />

      <FeedFulltextPolicyDialog
        open={Boolean(activeFulltextPolicyFeed)}
        feed={activeFulltextPolicyFeed}
        onOpenChange={(open) => {
          if (!open) {
            onFulltextPolicyClose();
          }
        }}
        onSubmit={onFulltextPolicySubmit}
      />

      <FeedTranslationPolicyDialog
        open={Boolean(activeTranslationPolicyFeed)}
        feed={activeTranslationPolicyFeed}
        onOpenChange={(open) => {
          if (!open) {
            onTranslationPolicyClose();
          }
        }}
        onSubmit={onTranslationPolicySubmit}
      />

      <AlertDialog
        open={Boolean(deleteFeedId)}
        onOpenChange={(open) => {
          if (!open) {
            onDeleteFeedClose();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {activeDeleteFeed ? `确定删除「${activeDeleteFeed.title}」？` : '确定删除该订阅源？'}
              删除后将移除订阅源及其文章，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDeleteFeedConfirm();
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteCategoryId)}
        onOpenChange={(open) => {
          if (!open) {
            onDeleteCategoryClose();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {activeDeleteCategory ? `确定删除「${activeDeleteCategory.name}」？` : '确定删除该分类？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-words text-sm text-muted-foreground">
            删除分类不会删除订阅源，订阅源会自动归并到"未分类"。
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  onDeleteCategoryConfirm();
                }}
              >
                删除
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}