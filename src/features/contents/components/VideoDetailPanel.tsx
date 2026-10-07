'use client';

import { useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type VideoTranscriptStatus = 'none' | 'extracting' | 'done' | 'failed';

export interface VideoDetailPanelProps {
  title: string;
  provider?: string | null;
  /** 站内播放地址（同源流）；有则用 <video> 播放 */
  streamUrl?: string | null;
  /** 外部嵌入地址（B站 iframe 等）；无 streamUrl 时使用 */
  embedUrl?: string | null;
  /** 封面 */
  poster?: string | null;
  /** 原站链接 */
  canonicalUrl?: string | null;
  /** 文案 */
  transcriptText?: string | null;
  transcriptSource?: string | null;
  transcriptStatus?: VideoTranscriptStatus;
  transcriptError?: string | null;
  /** 已下载到本地 */
  downloaded?: boolean;
  videoFileName?: string | null;
  /** 进行中状态 */
  extracting?: boolean;
  downloading?: boolean;
  /** 回调 */
  onExtract?: () => void;
  onDownload?: () => void;
  onGenerate?: () => void;
  onClip?: () => void;
  className?: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  bilibili: 'Bilibili',
  douyin: '抖音',
  generic: '视频',
};

function withAutoplay(embedUrl: string): string {
  const sep = embedUrl.includes('?') ? '&' : '?';
  return `${embedUrl}${sep}autoplay=1`;
}

/**
 * 统一的视频详情面板 —— 站内播放 + 下载 + 文案提取（含状态/重试）+ 二创入口。
 *
 * 纯展示组件：数据与回调由外层注入，因此文章阅读页、收藏详情、选题池详情
 * 都能复用同一套交互（站内能播就用 <video>，否则退化为 iframe / 封面+原站）。
 */
export default function VideoDetailPanel({
  title,
  provider,
  streamUrl,
  embedUrl,
  poster,
  canonicalUrl,
  transcriptText,
  transcriptSource,
  transcriptStatus = 'none',
  transcriptError,
  downloaded,
  videoFileName,
  extracting,
  downloading,
  onExtract,
  onDownload,
  onGenerate,
  onClip,
  className,
}: VideoDetailPanelProps) {
  const [playerActive, setPlayerActive] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [streamFailed, setStreamFailed] = useState(false);

  const providerLabel = PROVIDER_LABEL[provider ?? 'generic'] ?? provider ?? '视频';
  const canStream = Boolean(streamUrl) && !streamFailed;
  const showExtracting = extracting || transcriptStatus === 'extracting';
  const showFailed = transcriptStatus === 'failed';
  const showDone = transcriptStatus === 'done' && Boolean(transcriptText);

  return (
    <section
      data-testid="video-detail-panel"
      className={cn('overflow-hidden rounded-2xl border border-border/70 bg-black', className)}
      aria-label="视频详情"
    >
      {/* ── 播放区 ── */}
      <div className="relative aspect-video w-full bg-black">
        {canStream ? (
          <video
            data-testid="video-detail-stream"
            src={streamUrl ?? undefined}
            poster={poster ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full"
            onError={() => setStreamFailed(true)}
          />
        ) : embedUrl ? (
          playerActive ? (
            <iframe
              title={`播放视频：${title}`}
              src={withAutoplay(embedUrl)}
              className="absolute inset-0 h-full w-full"
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlayerActive(true)}
              className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/20 transition-colors hover:bg-black/10"
              aria-label="播放视频"
            >
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
              ) : null}
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-lg">
                <Play className="ml-0.5 h-6 w-6 fill-black text-black" />
              </span>
            </button>
          )
        ) : (
          <div className="absolute inset-0">
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
            ) : null}
            <div className="absolute inset-0 flex items-center justify-center">
              {canonicalUrl ? (
                <a
                  href={canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-white/90 px-4 py-2 text-xs font-medium text-black"
                >
                  前往原站观看
                </a>
              ) : null}
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 via-black/20 to-transparent p-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white ring-1 ring-white/18 backdrop-blur-md">
            <Play className="h-3.5 w-3.5 fill-current" />
            {providerLabel}
          </span>
          {canStream ? (
            <span className="rounded-full bg-white/12 px-2.5 py-1 text-[11px] text-white/80 ring-1 ring-white/18 backdrop-blur-md">
              站内播放
            </span>
          ) : null}
        </div>
        {streamFailed ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-black/80 px-3 py-2 text-[11px] text-white/80">
            <span>站内播放失败</span>
            <button
              type="button"
              onClick={() => setStreamFailed(false)}
              className="rounded-full border border-white/20 px-2.5 py-1 text-white/90"
            >
              重试
            </button>
          </div>
        ) : null}
      </div>

      {/* ── 信息 + 操作 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-black/96 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{providerLabel}</div>
          <h2 className="truncate text-sm font-semibold text-white/92">{title}</h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {onExtract ? (
            <button
              type="button"
              onClick={onExtract}
              disabled={showExtracting}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-50"
              title={showDone ? '重新提取文案' : '提取文案'}
            >
              {showExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              {showExtracting ? '提取中…' : showDone ? '重新提取' : showFailed ? '重试提取' : '提取文案'}
            </button>
          ) : null}
          {onDownload ? (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-50"
              title={downloaded ? '视频已下载' : '下载视频'}
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {downloading ? '下载中…' : downloaded ? '已下载' : '下载视频'}
            </button>
          ) : null}
          {onGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary-foreground/95 transition-colors hover:bg-primary/25"
              title="按平台风格二创改写"
            >
              <Sparkles className="h-3.5 w-3.5" />
              二创
            </button>
          ) : null}
          {onClip ? (
            <button
              type="button"
              onClick={onClip}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400/90 transition-colors hover:bg-amber-500/20 hover:text-amber-300"
              title="使用 OpenChatCut 剪辑视频"
            >
              <Scissors className="h-3.5 w-3.5" />
              去剪辑
            </button>
          ) : null}
          {canonicalUrl ? (
            <a
              href={canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              原站
            </a>
          ) : null}
        </div>
      </div>

      {/* ── 文案区 ── */}
      {showExtracting ? (
        <div className="flex items-center gap-2 border-t border-white/10 bg-black/90 px-4 py-3 text-xs text-white/60">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在下载视频并提取文案，约 30-60 秒…
        </div>
      ) : showFailed ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-black/90 px-4 py-3 text-xs">
          <span className="flex items-center gap-1.5 text-amber-400/90">
            <AlertCircle className="h-3.5 w-3.5" />
            {transcriptError || '文案提取失败'}
          </span>
          {onExtract ? (
            <button
              type="button"
              onClick={onExtract}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-white/80 hover:text-white"
            >
              <RefreshCw className="h-3 w-3" />
              重试提取
            </button>
          ) : null}
        </div>
      ) : showDone ? (
        <div className="border-t border-white/10 bg-black/90">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-white/60 transition-colors hover:text-white/80"
          >
            <span className="flex items-center gap-1.5">
              视频文案
              {transcriptSource ? (
                <span className="text-white/40">({transcriptSource === 'subtitle' ? '字幕' : '语音识别'})</span>
              ) : null}
              {transcriptText ? <span className="text-white/40">· {transcriptText.length} 字</span> : null}
            </span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
          </button>
          {expanded ? (
            <div className="max-h-80 overflow-y-auto border-t border-white/5 px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">{transcriptText}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── 下载状态 ── */}
      {downloaded ? (
        <div className="flex items-center gap-2 border-t border-white/10 bg-black/90 px-4 py-2.5 text-xs text-white/60">
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={videoFileName ?? undefined}>
            已下载到本地{videoFileName ? ` · ${videoFileName}` : ''}
          </span>
        </div>
      ) : null}
    </section>
  );
}
