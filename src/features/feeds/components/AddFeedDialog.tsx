import type { Category } from '../../../types';
import FeedDialog, { type FeedDialogSubmitPayload } from './FeedDialog';

interface AddFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  presetUrl?: string;
  presetTitle?: string;
  onSubmit: (payload: FeedDialogSubmitPayload) => Promise<void>;
}

export default function AddFeedDialog({ open, onOpenChange, categories, presetUrl, presetTitle, onSubmit }: AddFeedDialogProps) {
  return (
    <FeedDialog
      mode="add"
      open={open}
      onOpenChange={onOpenChange}
      categories={categories}
      initialValues={
        presetUrl
          ? { url: presetUrl, title: presetTitle ?? '' }
          : undefined
      }
      readOnlyFields={
        presetUrl ? { url: true, title: false } : undefined
      }
      onSubmit={onSubmit}
    />
  );
}