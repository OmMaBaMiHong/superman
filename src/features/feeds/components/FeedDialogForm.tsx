import type { FormEvent, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Category, FeedContentView } from '../../../types';
import CreatableCategoryField from './CreatableCategoryField';
import FeedViewSelector from './FeedViewSelector';
import type { FeedDiscoveryInputType } from '../hooks/useFeedDialogForm';

interface FeedDialogFormProps {
  badgeText: string;
  badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline';
  canResolveSourceUrl: boolean;
  canSave: boolean;
  categoryInput: string;
  categoryOptions: Category[];
  categoryDisabled?: boolean;
  fieldIdPrefix: string;
  detectedInputType: FeedDiscoveryInputType;
  messageTone: string;
  onCancel: () => void;
  onCategoryChange: (value: string) => void;
  onResolveSourceUrl: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleBlur: () => void;
  onTitleChange: (value: string) => void;
  onUrlBlur: (value: string) => void;
  onUrlChange: (value: string) => void;
  onViewChange: (value: FeedContentView) => void;
  sectionLabel: string;
  submitError: string | null;
  submitLabel: string;
  submitting: boolean;
  submittingLabel: string;
  title: string;
  titleDisabled?: boolean;
  titleFieldError: string | null | undefined;
  titleInputRef: RefObject<HTMLInputElement | null>;
  url: string;
  urlDisabled?: boolean;
  urlFieldError: string | null | undefined;
  urlInputRef: RefObject<HTMLInputElement | null>;
  validationIcon?: LucideIcon;
  validationIconClassName?: string;
  validationMessage: string | null;
  view: FeedContentView;
}

export default function FeedDialogForm({
  badgeText,
  badgeVariant,
  canResolveSourceUrl,
  canSave,
  categoryInput,
  categoryOptions,
  categoryDisabled = false,
  fieldIdPrefix,
  detectedInputType,
  messageTone,
  onCancel,
  onCategoryChange,
  onResolveSourceUrl,
  onSubmit,
  onTitleBlur,
  onTitleChange,
  onUrlBlur,
  onUrlChange,
  onViewChange,
  sectionLabel,
  submitError,
  submitLabel,
  submitting,
  submittingLabel,
  title,
  titleDisabled = false,
  titleFieldError,
  titleInputRef,
  url,
  urlDisabled = false,
  urlFieldError,
  urlInputRef,
  validationIcon: ValidationIcon,
  validationIconClassName,
  validationMessage,
  view,
}: FeedDialogFormProps) {
  const urlInputId = `${fieldIdPrefix}-url`;
  const urlLabelId = `${fieldIdPrefix}-url-label`;
  const titleInputId = `${fieldIdPrefix}-title`;
  const titleLabelId = `${fieldIdPrefix}-title-label`;
  const categoryInputId = `${fieldIdPrefix}-category`;
  const categoryLabelId = `${fieldIdPrefix}-category-label`;
  const viewLabelId = `${fieldIdPrefix}-view-label`;
  const urlMessageId = `${fieldIdPrefix}-url-message`;
  const titleMessageId = `${fieldIdPrefix}-title-message`;
  const categoryHintId = `${fieldIdPrefix}-category-hint`;
  const submitErrorId = `${fieldIdPrefix}-submit-error`;

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={submitting} noValidate>
      <div className="space-y-4 border-b border-border pb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.12em] text-primary">{sectionLabel}</p>
          </div>
          <Badge variant={badgeVariant} className="h-7 rounded-full px-2.5 text-xs font-medium">
            {badgeText}
          </Badge>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label id={urlLabelId} className="text-xs">
              URL
            </Label>
            <div className="flex gap-2">
              <Input
                ref={urlInputRef}
                id={urlInputId}
                name="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={url}
                disabled={urlDisabled}
                onChange={(event) => onUrlChange(event.target.value)}
                onBlur={(event) => onUrlBlur(event.currentTarget.value)}
                placeholder="RSS、rsshub:// 或平台主页/短链…"
                aria-labelledby={urlLabelId}
                aria-invalid={urlFieldError ? 'true' : 'false'}
                aria-describedby={urlMessageId}
                aria-errormessage={urlFieldError ? urlMessageId : undefined}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 px-3 text-xs"
                onClick={onResolveSourceUrl}
                disabled={urlDisabled || !canResolveSourceUrl}
              >
                识别 RSSHub 订阅
              </Button>
            </div>
            <p
              id={urlMessageId}
              role={urlFieldError ? 'alert' : 'status'}
              aria-live={urlFieldError ? 'assertive' : 'polite'}
              className={`mt-1 break-all text-xs ${urlFieldError ? 'text-destructive' : messageTone}`}
            >
              {urlFieldError || validationMessage ? (
                <span className="inline-flex items-center gap-1">
                  {!urlFieldError && ValidationIcon ? (
                    <ValidationIcon size={13} className={validationIconClassName} />
                  ) : null}
                  {urlFieldError ?? validationMessage}
                </span>
              ) : null}
            </p>
            {detectedInputType === 'rsshub' ? (
              <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-primary">已识别为内置 RSSHub 路由</p>
                <p className="mt-0.5">保存后会通过本地 RSSHub 转换为可阅读 RSS。</p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label id={titleLabelId} className="text-xs">
              名称
            </Label>
            <Input
              ref={titleInputRef}
              id={titleInputId}
              name="title"
              type="text"
              autoComplete="off"
              value={title}
              disabled={titleDisabled}
              onChange={(event) => onTitleChange(event.target.value)}
              onBlur={onTitleBlur}
              placeholder="例如：The Verge…"
              aria-labelledby={titleLabelId}
              aria-invalid={titleFieldError ? 'true' : 'false'}
              aria-describedby={titleFieldError ? titleMessageId : undefined}
              aria-errormessage={titleFieldError ? titleMessageId : undefined}
            />
            {titleFieldError ? (
              <p id={titleMessageId} role="alert" className="text-xs text-destructive">
                {titleFieldError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label id={viewLabelId} className="text-xs">
              视图
            </Label>
            <FeedViewSelector labelId={viewLabelId} value={view} onChange={onViewChange} />
          </div>

          <div className="grid gap-1.5">
            <Label id={categoryLabelId} className="text-xs">
              分类
            </Label>
            <CreatableCategoryField
              describedBy={categoryHintId}
              inputId={categoryInputId}
              labelledBy={categoryLabelId}
              value={categoryInput}
              options={categoryOptions}
              onChange={onCategoryChange}
              disabled={categoryDisabled}
            />
            <p id={categoryHintId} className="text-xs text-muted-foreground">
              可直接输入新分类名称，保存时会自动创建并归类到该分类。
            </p>
          </div>
        </div>
      </div>

      {submitError ? (
        <p id={submitErrorId} role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <DialogFooter className="sticky bottom-0 -mx-1 border-t border-border/60 bg-background/95 px-1 pt-3 backdrop-blur dark:border-white/[0.06] dark:bg-background/95">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          取消
        </Button>
        <Button type="submit" disabled={!canSave} aria-describedby={submitError ? submitErrorId : undefined}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
