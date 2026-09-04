import { AlertCircle, CheckCircle2, Loader2, RadioTower, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DIALOG_FORM_CONTENT_CLASS_NAME } from '@/lib/ui/designSystem';
import type { UserOperationActionKey } from '@/lib/userOperationCatalog';
import type { Category } from '../../../types';
import FeedDialogForm from './FeedDialogForm';
import type {
  FeedDialogInitialValues,
  FeedDialogMode,
  FeedDialogSubmitPayload,
  ValidationState,
} from '../feedDialog.types';
import { useFeedDialogForm } from '../hooks';

export type { FeedDialogSubmitPayload } from '../feedDialog.types';

interface FeedDialogProps {
  mode: FeedDialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  initialValues?: Partial<FeedDialogInitialValues>;
  readOnlyFields?: { title?: boolean; url?: boolean; category?: boolean };
  onSubmit: (payload: FeedDialogSubmitPayload) => Promise<void>;
}

interface ValidationStateMeta {
  badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline';
  badgeText: string;
  messageTone: string;
  icon?: LucideIcon;
  iconClassName?: string;
}

interface RssHubStatusState {
  available: boolean;
  baseUrl: string;
  message: string | null;
}

interface ModeMeta {
  actionKey: UserOperationActionKey;
  closeLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  sectionLabel: string;
  submitLabel: string;
  submittingLabel: string;
}

const VALIDATION_STATE_META: Record<ValidationState, ValidationStateMeta> = {
  idle: {
    badgeVariant: 'secondary',
    badgeText: '待验证',
    messageTone: 'text-muted-foreground',
  },
  validating: {
    badgeVariant: 'outline',
    badgeText: '验证中',
    messageTone: 'text-muted-foreground',
    icon: Loader2,
    iconClassName: 'animate-spin',
  },
  verified: {
    badgeVariant: 'default',
    badgeText: '验证成功',
    messageTone: 'text-success',
    icon: CheckCircle2,
  },
  failed: {
    badgeVariant: 'destructive',
    badgeText: '验证失败',
    messageTone: 'text-destructive',
    icon: AlertCircle,
  },
};

const MODE_META: Record<FeedDialogMode, ModeMeta> = {
  add: {
    actionKey: 'feed.create',
    closeLabel: '关闭添加 RSS 源',
    dialogTitle: '添加 RSS 源',
    dialogDescription: '输入 RSS 地址后，我们会自动验证链接，并尽量补全订阅名称。',
    sectionLabel: '订阅信息',
    submitLabel: '添加订阅源',
    submittingLabel: '正在添加订阅源…',
  },
  edit: {
    actionKey: 'feed.update',
    closeLabel: '关闭编辑 RSS 源',
    dialogTitle: '编辑 RSS 源',
    dialogDescription: '修改订阅地址、名称或分类。保存后不会影响已有文章。',
    sectionLabel: '订阅信息',
    submitLabel: '保存订阅源',
    submittingLabel: '正在保存订阅源…',
  },
};

function getInputTypeLabel(inputType: ReturnType<typeof useFeedDialogForm>['detectedInputType']) {
  switch (inputType) {
    case 'rsshub':
      return '内置 RSSHub';
    case 'rss':
      return '普通 RSS';
    case 'empty':
      return '等待输入';
  }
}


export default function FeedDialog({
  mode,
  open,
  onOpenChange,
  categories,
  initialValues,
  readOnlyFields,
  onSubmit,
}: FeedDialogProps) {
  const modeMeta = MODE_META[mode];
  const form = useFeedDialogForm({
    actionKey: modeMeta.actionKey,
    categories,
    initialValues,
    skipUrlValidation: Boolean(readOnlyFields?.url),
    onSubmit,
    onOpenChange,
  });
  const validationMeta = VALIDATION_STATE_META[form.validationState];
  const ValidationIcon = validationMeta.icon;
  const fieldIdPrefix = mode === 'add' ? 'add-feed' : 'edit-feed';
  const [rssHubStatus, setRssHubStatus] = useState<RssHubStatusState>({
    available: false,
    baseUrl: '',
    message: null,
  });

  useEffect(() => {
    if (!open || mode !== 'add') return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/rsshub/status');
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: { available?: boolean; baseUrl?: string };
          error?: { message?: string };
        };
        if (cancelled) return;
        setRssHubStatus({
          available: Boolean(payload.data?.available),
          baseUrl: payload.data?.baseUrl ?? '',
          message: payload.error?.message ?? null,
        });
      } catch {
        if (cancelled) return;
        setRssHubStatus({
          available: false,
          baseUrl: '',
          message: '无法检查本地 RSSHub 状态',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={modeMeta.closeLabel}
        className={`${DIALOG_FORM_CONTENT_CLASS_NAME} flex max-h-[min(720px,calc(100vh-2rem))] flex-col overflow-hidden`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          form.urlInputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{modeMeta.dialogTitle}</DialogTitle>
          <DialogDescription>{modeMeta.dialogDescription}</DialogDescription>
        </DialogHeader>
        <div data-testid="feed-dialog-scroll-area" className="min-h-0 flex-1 overflow-y-auto pr-1">
          {mode === 'add' ? (
            <section role="search" aria-label="Discover 订阅源" className="mb-4 space-y-2">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Discover
                  </p>
                  <h3 className="text-sm font-semibold text-foreground">输入 RSS 或 RSSHub 路由</h3>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-muted/35 px-3 py-2 text-xs text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.03]">
                <RadioTower className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {rssHubStatus.available ? '本地 RSSHub 已就绪' : '本地 RSSHub 未就绪'}
                </span>
                {rssHubStatus.baseUrl ? <span>{rssHubStatus.baseUrl}</span> : null}
                {rssHubStatus.message ? <span>{rssHubStatus.message}</span> : null}
                <span className="ml-auto rounded-full border border-primary/15 bg-primary/5 px-2 py-0.5 text-primary">
                  {getInputTypeLabel(form.detectedInputType)}
                </span>
              </div>
            </section>
          ) : null}
          <FeedDialogForm
            badgeText={validationMeta.badgeText}
            badgeVariant={validationMeta.badgeVariant}
            canResolveSourceUrl={form.canResolveSourceUrl}
            canSave={form.canSave}
            categoryInput={form.categoryInput}
            categoryOptions={form.categoryOptions}
            categoryDisabled={Boolean(readOnlyFields?.category)}
            detectedInputType={form.detectedInputType}
            fieldIdPrefix={fieldIdPrefix}
            messageTone={validationMeta.messageTone}
            onCancel={() => onOpenChange(false)}
            onCategoryChange={form.setCategoryInput}
            onResolveSourceUrl={form.handleResolveSourceUrl}
            onSubmit={form.handleSubmit}
            onTitleBlur={form.handleTitleBlur}
            onTitleChange={form.handleTitleChange}
            onUrlBlur={form.handleUrlBlur}
            onUrlChange={form.handleUrlChange}
            onViewChange={form.setView}
            sectionLabel={modeMeta.sectionLabel}
            submitError={form.submitError}
            submitLabel={modeMeta.submitLabel}
            submitting={form.submitting}
            submittingLabel={modeMeta.submittingLabel}
            title={form.title}
            titleDisabled={Boolean(readOnlyFields?.title)}
            titleFieldError={form.titleFieldError}
            titleInputRef={form.titleInputRef}
            url={form.url}
            urlDisabled={Boolean(readOnlyFields?.url)}
            urlFieldError={form.urlFieldError}
            urlInputRef={form.urlInputRef}
            validationIcon={ValidationIcon}
            validationIconClassName={validationMeta.iconClassName}
            validationMessage={form.validationMessage}
            view={form.view}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
