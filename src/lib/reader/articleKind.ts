import type { Article } from '../../types';
import { getArticleVideoMeta } from '@/lib/media/video';

export type ArticleDisplayKind = 'article' | 'picture' | 'video' | 'social';

const SOCIAL_HOSTS = new Set([
  'bsky.app',
  'facebook.com',
  'instagram.com',
  'mastodon.social',
  'threads.net',
  'twitter.com',
  'weibo.com',
  'x.com',
  'xiaohongshu.com',
]);

function parseHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isSocialLink(link: string): boolean {
  const hostname = parseHostname(link);
  if (!hostname) return false;

  if (SOCIAL_HOSTS.has(hostname)) return true;
  return Array.from(SOCIAL_HOSTS).some((socialHost) => hostname.endsWith(`.${socialHost}`));
}

function hasImageContent(article: Pick<Article, 'content' | 'previewImage' | 'mediaAttachments'>): boolean {
  if (article.previewImage?.trim()) return true;
  if (/<img\b[^>]*\bsrc=["'][^"']+["']/i.test(article.content)) return true;
  return Boolean(
    article.mediaAttachments?.some((attachment) =>
      attachment.mimeType.toLowerCase().startsWith('image/'),
    ),
  );
}

export function getArticleDisplayKind(article: Article): ArticleDisplayKind {
  const videoMeta = getArticleVideoMeta({
    link: article.link,
    content: article.content,
    previewImage: article.previewImage,
    mediaAttachments: article.mediaAttachments,
  });
  if (videoMeta) return 'video';

  if (isSocialLink(article.link)) return 'social';
  if (hasImageContent(article)) return 'picture';

  return 'article';
}
