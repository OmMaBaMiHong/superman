'use client';

import { ExternalLink, Play } from 'lucide-react';
import { resolveVideoEmbed } from '@/lib/media/videoEmbed';

interface VideoEmbedProps {
  sourceUrl: string | null;
  previewImage?: string | null;
  title?: string;
}

/**
 * 视频条目嵌入播放器：
 * - B站：官方 iframe embed（16:9 圆角玻璃框）
 * - 抖音：封面图 +「在抖音打开」外链按钮（抖音 iframe 限制多，不硬嵌）
 * - 其他来源：渲染 null
 */
export default function VideoEmbed({ sourceUrl, previewImage, title }: VideoEmbedProps) {
  const embed = resolveVideoEmbed(sourceUrl);
  if (!embed) return null;

  if (embed.kind === 'bilibili') {
    return (
      <div
        data-testid="video-embed-bilibili"
        className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-black"
      >
        <iframe
          src={embed.embedUrl}
          title={title ?? 'B站视频'}
          className="aspect-video w-full"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div
      data-testid="video-embed-douyin"
      className="mt-4 overflow-hidden rounded-2xl border border-border/60"
    >
      {previewImage ? (
        <img src={previewImage} alt="" loading="lazy" className="max-h-64 w-full object-cover" />
      ) : null}
      <a
        href={embed.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-1.5 bg-secondary/60 px-4 py-3 text-sm font-medium text-primary transition-colors duration-150 hover:bg-accent"
      >
        <Play aria-hidden="true" className="h-4 w-4" />
        在抖音打开
        <ExternalLink aria-hidden="true" className="h-3 w-3" />
      </a>
    </div>
  );
}
