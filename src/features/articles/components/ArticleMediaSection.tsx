'use client';

import type { ArticleVideoMeta } from "@/lib/media/video";
import ArticleVideoHero from "./ArticleVideoHero";

interface PlayableMediaAttachment {
  url: string;
  mimeType: string;
}

interface ArticleMediaSectionProps {
  articleVideoMeta: ArticleVideoMeta | null;
  playableMediaAttachment: PlayableMediaAttachment | null;
  titleOriginal: string;
  articleId: string | null;
}

export default function ArticleMediaSection({
  articleVideoMeta,
  playableMediaAttachment,
  titleOriginal,
  articleId,
}: ArticleMediaSectionProps) {
  return (
    <>
      {articleVideoMeta ? (
        <ArticleVideoHero title={titleOriginal} meta={articleVideoMeta} articleId={articleId} />
      ) : null}

      {playableMediaAttachment ? (
        <section
          className="mb-5 rounded-lg border border-border/65 bg-card/70 p-3"
          aria-label="播客播放器"
        >
          {playableMediaAttachment.mimeType.toLowerCase().startsWith("audio/") ? (
            <audio
              data-testid="article-media-player"
              className="w-full"
              src={playableMediaAttachment.url}
              controls
              preload="metadata"
            />
          ) : (
            <video
              data-testid="article-media-player"
              className="max-h-[28rem] w-full rounded-md bg-black"
              src={playableMediaAttachment.url}
              controls
              preload="metadata"
            />
          )}
        </section>
      ) : null}
    </>
  );
}