'use client';

import { useCallback, useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import { inferPlatformFromUrl, type PublishPlatform } from '@/core/publish-tracking/platform';
import { registerPublishedPost } from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { PLATFORM_META } from '../lib/publishPlatforms';

interface PostRegisterSheetProps {
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
}

/** 登记作品 sheet：贴链接必填（平台自动识别显示），账号名/关联选题可选。 */
export default function PostRegisterSheet({ open, onClose, onRegistered }: PostRegisterSheetProps) {
  const [postUrl, setPostUrl] = useState('');
  const [accountName, setAccountName] = useState('');
  const [articleId, setArticleId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const detectedPlatform: PublishPlatform = postUrl.trim() ? inferPlatformFromUrl(postUrl.trim()) : 'other';
  const platformMeta = PLATFORM_META[detectedPlatform];

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!postUrl.trim() || submitting) return;
      setSubmitting(true);
      void registerPublishedPost({
        postUrl: postUrl.trim(),
        accountName: accountName.trim() || undefined,
        articleId: articleId.trim() || null,
      })
        .then(() => {
          toast.success('作品已登记，表现追踪已开启');
          setPostUrl('');
          setAccountName('');
          setArticleId('');
          onRegistered();
          onClose();
        })
        .catch(() => {})
        .finally(() => setSubmitting(false));
    },
    [postUrl, accountName, articleId, submitting, onClose, onRegistered],
  );

  return (
    <GlassDetailSheet open={open} onClose={onClose} ariaLabel="登记作品">
      <form className="space-y-4 px-5 pb-6 pt-1 sm:px-7" onSubmit={handleSubmit}>
        <div className="flex items-center gap-2">
          <Link2 aria-hidden="true" className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">登记作品</h2>
        </div>
        <p className="text-[12px] text-muted-foreground">
          发布后贴个链接，就能追踪播放/点赞/评论的 7 天曲线。B站已支持真实数据，其他平台授权后可用。
        </p>

        <div className="space-y-2">
          <label htmlFor="post-url-input" className="text-xs font-medium text-muted-foreground">
            作品链接 <span className="text-error">*</span>
          </label>
          <input
            id="post-url-input"
            type="url"
            required
            value={postUrl}
            onChange={(event) => setPostUrl(event.target.value)}
            placeholder="https://www.bilibili.com/video/BV…"
            className="h-11 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {postUrl.trim() ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              识别平台：
              <span
                data-testid="detected-platform"
                className={cn(
                  'inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium',
                  platformMeta.badgeClass,
                )}
              >
                {platformMeta.name}
              </span>
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="post-account-input" className="text-xs font-medium text-muted-foreground">
            账号名（可选）
          </label>
          <input
            id="post-account-input"
            type="text"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder="发布所用账号"
            className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="post-article-input" className="text-xs font-medium text-muted-foreground">
            关联选题文章 ID（可选，火了可自动送回审批台）
          </label>
          <input
            id="post-article-input"
            type="text"
            inputMode="numeric"
            value={articleId}
            onChange={(event) => setArticleId(event.target.value)}
            placeholder="来自选题池的文章 ID"
            className="h-11 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!postUrl.trim() || submitting}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5',
              'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {submitting ? '登记中…' : '登记并追踪'}
          </button>
        </div>
      </form>
    </GlassDetailSheet>
  );
}
