'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Link2, Loader2, PenLine } from 'lucide-react';
import { getContentDetail, type ContentDetail } from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { cn } from '@/lib/utils';
import { mediaUrl, normalizeMediaHtml } from '@/lib/mediaUrl';
import ContentVideoDetail from './ContentVideoDetail';

interface ContentDetailSheetProps {
  /** 非空即打开；传入内容 id。 */
  articleId: string | null;
  onClose: () => void;
  /** 点「生成稿件 / 二创」时回调（把详情交给上层，打开平台选择）。 */
  onGenerate?: (detail: ContentDetail) => void;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** 内容详情：视频（统一视频面板）/ 文章正文。 */
export default function ContentDetailSheet({ articleId, onClose, onGenerate }: ContentDetailSheetProps) {
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string) => {
    const d = await getContentDetail(id);
    setDetail(d);
    return d;
  }, []);

  useEffect(() => {
    if (!articleId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    void load(articleId)
      .catch(() => toast.error('加载详情失败'))
      .finally(() => setLoading(false));
  }, [articleId, load]);

  // 文案提取中 → 每 5 秒轮询刷新（把最新 detail 透传给视频面板）
  useEffect(() => {
    if (!articleId || detail?.video?.transcriptStatus !== 'extracting') return undefined;
    const timer = window.setInterval(() => {
      void load(articleId).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [articleId, detail?.video?.transcriptStatus, load]);

  const video = detail?.video ?? null;

  return (
    <GlassDetailSheet
      open={articleId !== null}
      onClose={onClose}
      ariaLabel={detail ? `详情：${detail.title ?? ''}` : '内容详情'}
    >
      <div className="space-y-4 px-5 pb-10 pt-2 sm:px-7">
        {loading && !detail ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : detail ? (
          <>
            {/* 视频：统一视频详情面板 */}
            {video && articleId ? (
              <ContentVideoDetail
                articleId={articleId}
                detail={detail}
                onGenerate={onGenerate}
              />
            ) : (
              <>
                {detail.clip?.imageUrls?.length ? (
                  // 图片收藏：多图网格（收藏时可能是 1~10 张）
                  <div className="grid grid-cols-2 gap-2">
                    {detail.clip.imageUrls.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={url}
                        src={mediaUrl(url)}
                        alt=""
                        className="w-full rounded-xl border border-border/60 object-cover"
                      />
                    ))}
                  </div>
                ) : detail.previewImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(detail.previewImageUrl)}
                    alt=""
                    className="max-h-72 w-full rounded-2xl border border-border/60 object-cover"
                  />
                ) : null}
                <div>
                  <h2 className="text-[17px] font-semibold leading-snug text-foreground">
                    {detail.title || '未命名内容'}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {detail.qualityScore !== null ? (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
                        {detail.qualityScore} 分
                      </span>
                    ) : null}
                    {detail.directionKey ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {detail.directionKey}
                      </span>
                    ) : null}
                    <span>{detail.origin === 'clipboard' ? '收藏' : detail.origin ?? '内容'}</span>
                    {detail.publishedAt ? <span>· {detail.publishedAt.slice(0, 10)}</span> : null}
                  </div>
                </div>
                {detail.sourceUrl ? (
                  <a
                    href={detail.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{hostOf(detail.sourceUrl) ?? detail.sourceUrl}</span>
                    <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : null}
                {(detail.summary || detail.contentHtml) ? (
                  <section className="rounded-2xl border border-border/60 bg-card/60 p-3">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      <h3 className="text-[13px] font-medium text-foreground">正文</h3>
                    </div>
                    <div
                      className="prose prose-sm mt-2 max-h-80 overflow-y-auto text-[13px] leading-relaxed text-secondary-foreground [&_img]:rounded-lg"
                      // 收藏正文来自可信来源（article-extractor / 文案），此处仅作展示
                      dangerouslySetInnerHTML={{ __html: normalizeMediaHtml(detail.contentHtml || `<p>${detail.summary ?? ''}</p>`) }}
                    />
                  </section>
                ) : null}
                {onGenerate ? (
                  <button
                    type="button"
                    onClick={() => onGenerate(detail)}
                    className={cn(
                      'inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary',
                      'text-sm font-medium text-primary-foreground shadow-md shadow-primary/20 hover:opacity-90',
                    )}
                  >
                    <PenLine className="h-4 w-4" />
                    生成稿件（二创）
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    已收藏，可在「创作台 → 选题池」生成稿件
                  </div>
                )}

      {onGenerate && detail ? (
        <a
          href={`#/remake?article=${encodeURIComponent(detail.id)}`}
          className={cn(
            'mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-brand/40 bg-brand/5 px-4 py-3 text-sm font-semibold text-brand transition-colors hover:bg-brand/10',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5l5 2.5-5 2.5z"/></svg>
          生成同款视频
        </a>
      ) : null}
              </>
            )}
          </>
        ) : null}
      </div>
    </GlassDetailSheet>
  );
}
