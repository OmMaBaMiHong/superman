'use client';

import { withAccessToken } from '@/lib/sessionToken';
import { useCallback, useEffect, useState } from 'react';
import { getContentDetail, requestVideoTranscript, type ContentDetail } from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import VideoDetailPanel from './VideoDetailPanel';

interface ContentVideoDetailProps {
  articleId: string;
  /** 覆盖站内播放地址（如订阅作品的同源流）；默认用本地已下载视频 */
  streamUrl?: string | null;
  /** 覆盖标题 */
  title?: string;
  /** 已拉取的详情（避免重复请求）；不传则自行拉取 */
  detail?: ContentDetail | null;
  onGenerate?: (detail: ContentDetail) => void;
  className?: string;
}

/**
 * 自包含的视频详情：拉取素材 → 渲染统一的 VideoDetailPanel。
 * 收藏详情、选题池详情、阅读页订阅视频都复用它。
 */
export default function ContentVideoDetail({
  articleId,
  streamUrl,
  title,
  detail: detailProp,
  onGenerate,
  className,
}: ContentVideoDetailProps) {
  const [detail, setDetail] = useState<ContentDetail | null>(detailProp ?? null);
  const [retrying, setRetrying] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async (id: string) => {
    const d = await getContentDetail(id);
    setDetail(d);
    return d;
  }, []);

  useEffect(() => {
    if (detailProp) {
      setDetail(detailProp);
      return;
    }
    void load(articleId).catch(() => undefined);
  }, [articleId, detailProp, load]);

  const video = detail?.video ?? null;

  // 文案提取中 → 每 5 秒轮询刷新
  useEffect(() => {
    if (detailProp || video?.transcriptStatus !== 'extracting') return undefined;
    const timer = window.setInterval(() => {
      void load(articleId).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [articleId, detailProp, video?.transcriptStatus, load]);

  const handleExtract = useCallback(async () => {
    if (!video?.videoUrl) {
      toast.error('缺少视频地址，无法提取文案');
      return;
    }
    setRetrying(true);
    try {
      await requestVideoTranscript({
        articleId,
        url: video.videoUrl,
        videoTitle: video.videoTitle ?? undefined,
        provider: video.provider ?? undefined,
      });
      toast.success('已开始提取文案');
      setDetail((prev) =>
        prev && prev.video
          ? { ...prev, video: { ...prev.video, transcriptStatus: 'extracting', transcriptError: null } }
          : prev,
      );
    } catch {
      // apiClient 已统一 toast
    } finally {
      setRetrying(false);
    }
  }, [articleId, video]);

  const handleDownload = useCallback(async () => {
    if (!video?.videoUrl) {
      toast.error('缺少视频地址，无法下载');
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch('/s/api/video/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: video.videoUrl, articleId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || '下载失败');
      toast.success(`视频已下载：${data.data.fileName}`);
      await load(articleId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败');
    } finally {
      setDownloading(false);
    }
  }, [articleId, video, load]);

  if (!video && !streamUrl) return null;

  // 没有素材行但有站内流（如订阅视频）→ 合成一个最小 video 块
  const effective = video ?? {
    videoUrl: detail?.sourceUrl ?? null,
    videoTitle: null,
    provider: null,
    transcriptText: null,
    transcriptSource: null,
    transcriptLanguage: null,
    transcriptExtractedAt: null,
    transcriptStatus: 'none' as const,
    transcriptError: null,
    videoFilePath: null,
    videoFileName: null,
    videoFileSize: null,
  };
  const downloaded = Boolean(effective.videoFilePath);

  return (
    <VideoDetailPanel
      className={className}
      title={title ?? detail?.title ?? effective.videoTitle ?? '视频'}
      provider={effective.provider}
      streamUrl={streamUrl ?? (downloaded ? withAccessToken(`/s/api/video/serve/${articleId}`) : null)}
      poster={detail?.previewImageUrl ?? null}
      canonicalUrl={detail?.sourceUrl ?? effective.videoUrl}
      transcriptText={effective.transcriptText}
      transcriptSource={effective.transcriptSource}
      transcriptStatus={effective.transcriptStatus}
      transcriptError={effective.transcriptError}
      downloaded={downloaded}
      videoFileName={effective.videoFileName}
      extracting={retrying}
      downloading={downloading}
      onExtract={effective.videoUrl ? handleExtract : undefined}
      onDownload={effective.videoUrl ? handleDownload : undefined}
      onGenerate={onGenerate && detail ? () => onGenerate(detail) : undefined}
      onClip={downloaded ? () => window.open(`http://localhost:5199/#/import/${articleId}`, '_blank') : undefined}
    />
  );
}
