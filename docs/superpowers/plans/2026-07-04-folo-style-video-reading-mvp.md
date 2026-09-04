# Folo-Style Video Reading MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RSSHub YouTube articles readable as first-class video entries in FeedFuse, with list and detail interactions inspired by Folo.

**Architecture:** Keep FeedFuse as the app shell and backend. Add a small derived video metadata layer that detects YouTube URLs from article link/content/media attachments, then render Folo-style video affordances in the existing `ArticleList` and `ArticleView` without migrating Folo stores or Electron-specific components.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand store, Vitest, Testing Library, Tailwind CSS.

---

## File Structure

- Create: `/Users/wade/work-space/FeedFuse/src/lib/media/video.ts`
  - Owns URL detection and conversion into embeddable video metadata.
- Create: `/Users/wade/work-space/FeedFuse/src/test/lib/media/video.test.ts`
  - Covers YouTube watch, short, embed, and non-video URLs.
- Create: `/Users/wade/work-space/FeedFuse/src/features/articles/components/ArticleVideoHero.tsx`
  - Renders a 16:9 YouTube iframe hero with title, provider badge, thumbnail fallback, and open-original action.
- Create: `/Users/wade/work-space/FeedFuse/src/test/features/articles/ArticleView.videoHero.test.tsx`
  - Proves detail view renders an iframe for a YouTube RSSHub article.
- Modify: `/Users/wade/work-space/FeedFuse/src/features/articles/components/ArticleView.tsx`
  - Compute video metadata for the selected article and render `ArticleVideoHero` above article body/media attachment fallback.
- Modify: `/Users/wade/work-space/FeedFuse/src/features/articles/components/ArticleList.tsx`
  - Compute video metadata for each row and render Folo-style video thumbnail treatment in card mode.
- Modify: `/Users/wade/work-space/FeedFuse/src/test/features/articles/ArticleList.test.tsx`
  - Proves card rows show video affordance and preserve selection behavior.

## Task 1: Video Metadata Detection

**Files:**
- Create: `/Users/wade/work-space/FeedFuse/src/lib/media/video.ts`
- Create: `/Users/wade/work-space/FeedFuse/src/test/lib/media/video.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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

  it('detects a YouTube handle URL from content links when link is missing', () => {
    expect(getArticleVideoMeta({
      content: '<a href="https://youtu.be/zjkBMFhNj_g">video</a>',
    })?.videoId).toBe('zjkBMFhNj_g');
  });

  it('returns null for non-video articles', () => {
    expect(getArticleVideoMeta({ link: 'https://example.com/article' })).toBeNull();
  });
});
```

Run: `pnpm test:unit src/test/lib/media/video.test.ts`

Expected: fail because `@/lib/media/video` does not exist.

- [ ] **Step 2: Implement minimal detector**

Implement `ArticleVideoMeta`, `getArticleVideoMeta`, and private helpers for:
- `youtube.com/watch?v=...`
- `youtu.be/...`
- `youtube.com/embed/...`
- `youtube.com/shorts/...`
- URLs found in sanitized article HTML.

- [ ] **Step 3: Verify detector**

Run: `pnpm test:unit src/test/lib/media/video.test.ts`

Expected: all tests pass.

## Task 2: Detail Video Hero

**Files:**
- Create: `/Users/wade/work-space/FeedFuse/src/features/articles/components/ArticleVideoHero.tsx`
- Create: `/Users/wade/work-space/FeedFuse/src/test/features/articles/ArticleView.videoHero.test.tsx`
- Modify: `/Users/wade/work-space/FeedFuse/src/features/articles/components/ArticleView.tsx`

- [ ] **Step 1: Write failing ArticleView test**

Render an article whose `link` is `https://www.youtube.com/watch?v=zjkBMFhNj_g`.

Assert:
- `screen.getByTestId('article-video-hero')` exists.
- The iframe title contains article title.
- The iframe `src` is `https://www.youtube.com/embed/zjkBMFhNj_g`.
- Existing article body still renders below the video.

Run: `pnpm test:unit src/test/features/articles/ArticleView.videoHero.test.tsx`

Expected: fail because no hero exists.

- [ ] **Step 2: Implement `ArticleVideoHero`**

Design direction:
- Folo-inspired 16:9 media-first block.
- Use dark glass overlay, provider badge, play affordance, open-original link.
- Use native iframe for YouTube in this MVP.
- Avoid importing Folo packages.

- [ ] **Step 3: Wire ArticleView**

In `ArticleView`, compute:

```ts
const articleVideoMeta = getArticleVideoMeta({
  link: article?.link,
  content: article?.content,
  previewImage: article?.previewImage,
  mediaAttachments: article?.mediaAttachments,
});
```

Render `<ArticleVideoHero />` before existing media attachment player. Keep audio/video attachment behavior unchanged.

- [ ] **Step 4: Verify detail behavior**

Run: `pnpm test:unit src/test/features/articles/ArticleView.videoHero.test.tsx src/test/features/articles/ArticleView.mediaAttachments.test.tsx`

Expected: all tests pass.

## Task 3: Folo-Style List Video Card

**Files:**
- Modify: `/Users/wade/work-space/FeedFuse/src/features/articles/components/ArticleList.tsx`
- Modify: `/Users/wade/work-space/FeedFuse/src/test/features/articles/ArticleList.test.tsx`

- [ ] **Step 1: Write failing list test**

Seed a card-mode article with YouTube link and preview image.

Assert:
- The row has `data-testid="article-video-card"`.
- It renders the preview image.
- It renders a play badge with accessible label `视频文章`.
- Clicking the row still selects the article.

Run: `pnpm test:unit src/test/features/articles/ArticleList.test.tsx`

Expected: fail because video card affordance does not exist.

- [ ] **Step 2: Implement card affordance**

In card mode, when `getArticleVideoMeta(article)` returns metadata:
- Use existing preview image layout.
- Add a small `VIDEO`/play chip over the thumbnail.
- Prefer `videoMeta.thumbnailUrl` if `article.previewImage` is empty.
- Keep list mode compact and do not add iframe previews yet.

- [ ] **Step 3: Verify list behavior**

Run: `pnpm test:unit src/test/features/articles/ArticleList.test.tsx`

Expected: all tests pass.

## Task 4: End-to-End Local Validation

**Files:**
- No planned code files.

- [ ] **Step 1: Refresh RSSHub YouTube feed**

Use existing local service at `http://127.0.0.1:9559`.

Test feed URL: `rsshub://youtube/user/@AndrejKarpathy`

- [ ] **Step 2: Browser/manual validation**

Open FeedFuse and verify:
- YouTube entries show video card affordance in the middle list.
- Selecting a YouTube entry shows a playable iframe at the top of detail pane.
- Existing RSS text article rendering still works.

- [ ] **Step 3: Final checks**

Run:

```bash
pnpm test:unit src/test/lib/media/video.test.ts src/test/features/articles/ArticleView.videoHero.test.tsx src/test/features/articles/ArticleView.mediaAttachments.test.tsx src/test/features/articles/ArticleList.test.tsx
pnpm type-check
pnpm lint
```

Expected: all commands exit 0.

## Self-Review

- Spec coverage: covers video recognition, Folo-style list affordance, detail video playback, and validation against RSSHub YouTube.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: `ArticleVideoMeta` is produced by `getArticleVideoMeta` and consumed by `ArticleVideoHero`, `ArticleView`, and `ArticleList`.
