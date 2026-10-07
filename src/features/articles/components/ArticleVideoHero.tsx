'use client';

import { useEffect, useState } from 'react';
import type { ArticleVideoMeta } from '@/lib/media/video';
import { toast } from '@/features/toast/toast';
import VideoDetailPanel, { type VideoTranscriptStatus } from '@/features/contents/components/VideoDetailPanel';

interface VideoMaterialData {
  transcriptText: string | null;
  transcriptSource: 'subtitle' | 'whisper' | null;
  transcriptLanguage: string | null;
  transcriptStatus?: VideoTranscriptStatus;
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

/**
 * 文章阅读页的视频详情 —— 复用统一的 VideoDetailPanel，
 * 数据来自 Next.js 的 /api/video/* 路由（站内播放 + 下载 + 文案）。
 */
export default function ArticleVideoHero({ title, meta, articleId, className }: ArticleVideoHeroProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptSource, setTranscriptSource] = useState<'subtitle' | 'whisper' | ''>('');
  const [transcriptStatus, setTranscriptStatus] = useState<VideoTranscriptStatus>('none');
  const [videoFileName, setVideoFileName] = useState<string | null>(null);

  // 页面加载时检查已有素材
  useEffect(() => {
    if (!articleId) return;
    fetch(`/api/video/material?articleId=${articleId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.data) {
          const m = data.data as VideoMaterialData;
          if (m.transcriptText) {
            setTranscriptText(m.transcriptText);
            setTranscriptSource(m.transcriptSource ?? '');
            setTranscriptStatus('done');
          } else if (m.transcriptStatus) {
            setTranscriptStatus(m.transcriptStatus);
          }
          if (m.videoFilePath) {
            setDownloaded(true);
            setVideoFileName(m.videoFileName);
          }
        }
      })
      .catch(() => {
        // 静默忽略，不影响页面展示
      });
  }, [articleId]);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/video/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: meta.canonicalUrl, ...(articleId ? { articleId } : {}) }),
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败', { dedupeKey: 'video-download-failed' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleTranscript() {
    if (transcribing) return;
    setTranscribing(true);
    setTranscriptStatus('extracting');
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
        setTranscriptStatus('done');
        toast.success('文案提取完成', { dedupeKey: 'video-transcript-done' });
      }
    } catch (err) {
      setTranscriptStatus('failed');
      toast.error(err instanceof Error ? err.message : '文案提取失败', { dedupeKey: 'video-transcript-failed' });
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <VideoDetailPanel
      className={className}
      title={title}
      provider={meta.provider}
      streamUrl={downloaded && articleId ? `/api/video/serve/${articleId}` : null}
      embedUrl={meta.embedUrl}
      poster={meta.thumbnailUrl}
      canonicalUrl={meta.canonicalUrl}
      transcriptText={transcriptText || null}
      transcriptSource={transcriptSource || null}
      transcriptStatus={transcriptStatus}
      downloaded={downloaded}
      videoFileName={videoFileName}
      extracting={transcribing}
      downloading={downloading}
      onExtract={handleTranscript}
      onDownload={handleDownload}
      onClip={downloaded && articleId ? () => window.open(`http://localhost:5199/#/import/${articleId}`, '_blank') : undefined}
    />
  );
}
