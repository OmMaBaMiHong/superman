'use client';

import { ChevronDown, Download, ExternalLink, FileText, Loader2, Play, Scissors } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ArticleVideoMeta } from '@/lib/media/video';
import { cn } from '@/lib/utils';
import { toast } from '@/features/toast/toast';

interface VideoMaterialData {
  transcriptText: string | null;
  transcriptSource: 'subtitle' | 'whisper' | null;
  transcriptLanguage: string | null;
  videoFilePath: string | null;
  videoFileName: string | null;
  videoFileSize: number | null;
}

interface ArticleVideoHeroProps {
  title: string;
  meta: ArticleVideoMeta;
  articleId: string | null;
  className?: string;
}

/** 为嵌入 URL 追加 autoplay 参数，点击播放按钮后立即开始播放 */
function withAutoplay(embedUrl: string): string {
  const sep = embedUrl.includes('?') ? '&' : '?';
  return `${embedUrl}${sep}autoplay=1`;
}

export default function ArticleVideoHero({
  title,
  meta,
  articleId,
  className,
}: ArticleVideoHeroProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptSource, setTranscriptSource] = useState<'subtitle' | 'whisper' | ''>('');
  const [transcriptExpanded, setTranscriptExpanded] = useState(true);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [materialLoaded, setMaterialLoaded] = useState(false);
  // 懒加载：点击播放按钮后才挂载 iframe，避免页面打开即自动播放
  const [playerActive, setPlayerActive] = useState(false);

  const providerLabel = {
    youtube: 'YouTube',
    bilibili: 'Bilibili',
    douyin: '抖音',
    generic: '视频',
  }[meta.provider];

  /** 刷新视频素材状态 */
  async function refreshMaterial() {
    if (!articleId) return;
    try {
      const res = await fetch(`/api/video/material?articleId=${articleId}`);
      const data = await res.json();
      if (data.ok && data.data) {
        const m = data.data as VideoMaterialData;
        if (m.transcriptText) {
          setTranscriptText(m.transcriptText);
          setTranscriptSource(m.transcriptSource ?? '');
        }
        if (m.videoFilePath) {
          setDownloaded(true);
          setVideoFilePath(m.videoFilePath);
          setVideoFileName(m.videoFileName);
        }
      }
    } catch {
      // 静默忽略
    }
  }

  // 页面加载时检查已有素材
  useEffect(() => {
    if (!articleId) return;
    setMaterialLoaded(false);
    fetch(`/api/video/material?articleId=${articleId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.data) {
          const m = data.data as VideoMaterialData;
          if (m.transcriptText) {
            setTranscriptText(m.transcriptText);
            setTranscriptSource(m.transcriptSource ?? '');
          }
          if (m.videoFilePath) {
            setDownloaded(true);
            setVideoFilePath(m.videoFilePath);
            setVideoFileName(m.videoFileName);
          }
        }
      })
      .catch(() => {
        // 静默忽略，不影响页面展示
      })
      .finally(() => {
        setMaterialLoaded(true);
      });
  }, [articleId]);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/video/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: meta.canonicalUrl,
          ...(articleId ? { articleId } : {}),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message || '下载失败');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/);
      const fileName = match ? decodeURIComponent(match[1]) : `${title}.mp4`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDownloaded(true);
      setVideoFileName(fileName);
      toast.success('视频已下载完成', { dedupeKey: 'video-downloaded' });

      // 下载完成后刷新素材状态，获取文件路径
      if (articleId) {
        await refreshMaterial();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败', { dedupeKey: 'video-download-failed' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleTranscript() {
    if (transcribing) return;
    setTranscribing(true);
    setTranscriptText('');
    try {
      const res = await fetch('/api/video/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: meta.canonicalUrl,
          ...(articleId ? { articleId } : {}),
          videoTitle: title,
          provider: meta.provider,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message || '文案提取失败');
      }

      const data = await res.json();
      if (data.ok) {
        setTranscriptText(data.data.text);
        setTranscriptSource(data.data.source);
        setTranscriptExpanded(true);
        toast.success('文案提取完成', { dedupeKey: 'video-transcript-done' });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '文案提取失败', { dedupeKey: 'video-transcript-failed' });
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <section
      data-testid="article-video-hero"
      className={cn(
        'mb-5 overflow-hidden rounded-2xl border border-border/70 bg-black shadow-[var(--shadow-glass)]',
        'dark:border-white/[0.08]',
        className,
      )}
      aria-label="视频播放器"
    >
      {/* 视频播放区域 */}
      <div className="relative aspect-video w-full bg-black">
        {meta.embedUrl ? (
          playerActive ? (
            <iframe
              title={`播放视频：${title}`}
              // 点击后才挂载，并自动开始播放
              src={withAutoplay(meta.embedUrl)}
              className="absolute inset-0 h-full w-full"
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            /* 播放覆盖层：未点击前不渲染 iframe，避免自动播放，同时防止 iframe 拦截滚动事件 */
            <button
              type="button"
              onClick={() => setPlayerActive(true)}
              className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/20 transition-colors hover:bg-black/10"
              aria-label="播放视频"
            >
              {meta.thumbnailUrl ? (
                <img
                  src={meta.thumbnailUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-60"
                />
              ) : null}
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-lg transition-transform hover:scale-105">
                <Play className="ml-0.5 h-6 w-6 fill-black text-black" />
              </div>
            </button>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-white/60">
            <a
              href={meta.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-white/90"
            >
              点击前往原站观看
            </a>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 via-black/20 to-transparent p-4 opacity-100 transition-opacity duration-200 group-hover:opacity-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white ring-1 ring-white/18 backdrop-blur-md">
            <Play className="h-3.5 w-3.5 fill-current" />
            Video
          </span>
        </div>
      </div>

      {/* 视频信息 + 操作按钮 */}
      <div className="flex items-center justify-between gap-3 bg-black/96 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
            {providerLabel}
          </div>
          <h2 className="truncate text-sm font-semibold text-white/92">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleTranscript}
            disabled={transcribing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50"
            title={transcriptText ? '查看文案' : '提取文案'}
          >
            {transcribing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            {transcribing ? '提取中...' : transcriptText ? '查看文案' : '提取文案'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50"
            title={downloaded ? '视频已下载' : '下载视频'}
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {downloading ? '下载中...' : downloaded ? '已下载' : '下载视频'}
          </button>
          {(downloaded || transcriptText) && articleId && (
            <button
              type="button"
              onClick={() => {
                const url = `http://localhost:5199/#/import/${articleId}`;
                window.open(url, '_blank');
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400/90 transition-colors hover:bg-amber-500/20 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
              title="使用 OpenChatCut 剪辑视频"
            >
              <Scissors className="h-3.5 w-3.5" />
              去剪辑
            </button>
          )}
          <a
            href={meta.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            原站
          </a>
        </div>
      </div>

      {/* 文案展示区域（内联，可折叠） */}
      {transcriptText && (
        <div className="border-t border-white/10 bg-black/90">
          <button
            type="button"
            onClick={() => setTranscriptExpanded(!transcriptExpanded)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-white/60 transition-colors hover:text-white/80"
          >
            <span>
              视频文案
              {transcriptSource === 'subtitle' ? (
                <span className="ml-2 text-white/40">(字幕)</span>
              ) : transcriptSource === 'whisper' ? (
                <span className="ml-2 text-white/40">(语音识别)</span>
              ) : null}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200',
                transcriptExpanded && 'rotate-180',
              )}
            />
          </button>
          {transcriptExpanded && (
            <div className="max-h-80 overflow-y-auto border-t border-white/5 px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">
                {transcriptText}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 下载状态提示 */}
      {downloaded && (
        <div className="border-t border-white/10 bg-black/90 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Download className="h-3.5 w-3.5 shrink-0 text-white/40" />
              <div className="min-w-0">
                <div className="text-xs text-white/70">已下载到本地</div>
                {videoFileName && (
                  <div className="truncate text-[11px] text-white/40" title={videoFilePath ?? undefined}>
                    {videoFileName}
                  </div>
                )}
              </div>
            </div>
            {articleId && (
              <a
                href={`/api/video/serve/${articleId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
              >
                <Play className="h-3 w-3 fill-current" />
                本地播放
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}