import { describe, expect, it } from 'vitest';
import { getArticleVideoMeta } from '@/lib/media/video';

describe('getArticleVideoMeta', () => {
  it('detects a YouTube watch URL', () => {
    expect(getArticleVideoMeta({ link: 'https://www.youtube.com/watch?v=zjkBMFhNj_g' })).toEqual({
      provider: 'youtube',
      videoId: 'zjkBMFhNj_g',
      embedUrl: 'https://www.youtube.com/embed/zjkBMFhNj_g',
      canonicalUrl: 'https://www.youtube.com/watch?v=zjkBMFhNj_g',
      thumbnailUrl: 'https://i.ytimg.com/vi/zjkBMFhNj_g/hqdefault.jpg',
    });
  });

  it('detects a youtu.be URL from article content when the link is missing', () => {
    expect(
      getArticleVideoMeta({
        content: '<p><a href="https://youtu.be/zjkBMFhNj_g">video</a></p>',
      })?.videoId,
    ).toBe('zjkBMFhNj_g');
  });

  it('detects YouTube shorts and embed URLs', () => {
    expect(getArticleVideoMeta({ link: 'https://www.youtube.com/shorts/zjkBMFhNj_g' })?.embedUrl).toBe(
      'https://www.youtube.com/embed/zjkBMFhNj_g',
    );
    expect(getArticleVideoMeta({ link: 'https://www.youtube.com/embed/zjkBMFhNj_g' })?.canonicalUrl).toBe(
      'https://www.youtube.com/watch?v=zjkBMFhNj_g',
    );
  });

  it('uses the stable YouTube thumbnail instead of an expiring feed preview image', () => {
    expect(
      getArticleVideoMeta({
        link: 'https://www.youtube.com/watch?v=zjkBMFhNj_g',
        previewImage: '/api/media/image?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2FzjkBMFhNj_g%2Fhqdefault.jpg%3Fsqp%3Dexpired&sig=old',
      })?.thumbnailUrl,
    ).toBe('https://i.ytimg.com/vi/zjkBMFhNj_g/hqdefault.jpg');
  });

  it('returns null for non-video articles', () => {
    expect(getArticleVideoMeta({ link: 'https://example.com/article' })).toBeNull();
  });
});
