# Folo UI Replication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework FeedFuse so its reader shell mirrors Folo's view-tab subscription column, video grid, and subscribe flow instead of treating media views as ordinary sidebar rows.

**Architecture:** Keep FeedFuse's Next/React/Zustand stack. Add a Folo-style view-tab layer above the feed tree, store feed `view` membership locally, and render video/image/social/article timelines with view-specific list layouts. Keep RSSHub integration as a source adapter, not as a remote Folo dependency.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Testing Library, Tailwind, existing FeedFuse UI primitives.

---

## Folo Interaction Baseline

### Left Subscription Column

Folo uses three visual layers:

1. Header: app controls and add button.
2. Timeline tab row: icon-only tabs for All, Articles, Social, Pictures, Videos, optionally Audio and Notifications. Each tab shows unread count or dot. Active tab changes icon color.
3. Subscription list for active tab: title row such as `视频`, sort action, unread count, then starred/list/inbox/feed sections filtered by the selected view.

Important source files:

- `/Users/wade/work-space/Folo/packages/internal/constants/src/tabs.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/subscription-column/SubscriptionTabButton.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/subscription-column/index.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/subscription-column/subscription-list/ListHeader.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/subscription-column/subscription-list/SubscriptionList.tsx`

Current FeedFuse mismatch:

- `文章 / 图片 / 视频 / 社交` were added as ordinary `smartViews` rows in `FeedList.tsx`.
- This pushes them into the same hierarchy as `全部文章 / 收藏文章 / 智能报告`, which is not how Folo works.
- The active view should filter which feeds/categories are shown, not be just another feed row.

### Video Timeline

Folo's video view is a wide grid timeline:

1. Uses responsive columns and 16:9 thumbnails.
2. Video card shows thumbnail, duration badge, title, feed icon/title, and relative time.
3. On hover, after a short delay, it can swap thumbnail to a mini iframe/webview preview.
4. Selecting a card opens a video-focused detail layout with player first, title/content/transcript below.

Important source files:

- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/entry-column/grid.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/entry-column/Items/video-item.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/MediaLayout.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/VideosLayout.tsx`

Current FeedFuse mismatch:

- Video view still uses the middle article list card height.
- It has a small label and preview chip, but not the Folo grid browsing experience.

### Subscribe / Discover Flow

Folo separates discovery/search from final subscription settings:

1. Discover page/search accepts normal RSS URLs and `rsshub://` routes.
2. Search results/recommendations show feed cards with sample entries.
3. Follow form includes `title`, `category`, private/hide settings, and importantly `view` selection.
4. The view selector is a radio group using the same view definitions as the timeline tabs.
5. When feed entries are available, the form previews the first entries using the selected view's card layout.

Important source files:

- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/discover/UnifiedDiscoverForm.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/discover/FeedForm.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/shared/ViewSelectorRadioGroup.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/discover/DiscoveryContent.tsx`
- `/Users/wade/work-space/Folo/apps/desktop/layer/renderer/src/modules/discover/DiscoverFeedCard.tsx`

Current FeedFuse mismatch:

- Add dialog has URL/title/category only.
- Recommended feed cards fill a category string, but do not set a persistent feed view.
- FeedFuse needs category and view as separate concepts: `category = folder/group`, `view = article/picture/video/social timeline`.

---

## Target FeedFuse Behavior

1. The left rail top has a compact Folo-style tab row: `全部 / 文章 / 社交 / 图片 / 视频 / 智能报告` for this MVP.
2. Selecting a tab changes `selectedView` and filters the feed tree below to feeds belonging to that view.
3. The current tab's list header shows the view name and count.
4. `收藏文章` stays as a secondary row below the tab header, not mixed with media tabs.
5. Feeds have a persisted `view` field separate from `categoryId`.
6. Add/edit feed dialogs include a view selector and category selector.
7. Recommended feed cards can set both view and category. Andrej Karpathy defaults to `视频`.
8. Video view renders as a responsive grid with 16:9 cards.
9. Clicking a video card selects the article and opens the existing right pane video hero/detail.

---

## Task 1: Introduce Feed View Metadata

**Files:**

- Modify: `src/types/index.ts`
- Modify: `src/lib/reader/view.ts`
- Modify: `src/lib/api/apiClient.ts`
- Modify: server feed DTO mapping files touched by existing feed create/update routes.
- Test: `src/test/app/api/feeds/routes.test.ts`

- [ ] Add a feed-level view type.

```ts
export type FeedContentView = 'article' | 'picture' | 'video' | 'social' | 'digest';
```

- [ ] Add `view?: FeedContentView` to `Feed`.
- [ ] Map existing feeds without `view` to `'article'`.
- [ ] Keep existing `categoryId` unchanged.
- [ ] Add route tests proving feed create/update accepts `{ view: 'video', categoryId: 'cat-ai' }`.
- [ ] Run: `pnpm test:unit src/test/app/api/feeds/routes.test.ts`

Expected: feed payload stores/returns both `view` and `categoryId`.

## Task 2: Replace Smart Rows With Folo-Style View Tabs

**Files:**

- Modify: `src/features/feeds/components/FeedList.tsx`
- Create: `src/features/feeds/components/FeedViewTabs.tsx`
- Test: `src/test/features/feeds/FeedList.test.tsx`

- [ ] Remove `文章 / 图片 / 视频 / 社交` from the `smartViews` list.
- [ ] Create a horizontal tab row below the header.
- [ ] Tab order for MVP: `全部`, `文章`, `社交`, `图片`, `视频`, `智能报告`.
- [ ] Each tab has icon, unread/count text, active color, and click handler.
- [ ] The feed tree below the tabs only shows feeds matching active view, except `全部` shows all RSS feeds.
- [ ] Keep `收藏文章` as a normal row below the tabs.
- [ ] Add tests:
  - tabs render in the Folo order.
  - clicking `视频` updates selected view to video.
  - `视频` view only lists feeds whose `feed.view === 'video'`.
  - `收藏文章` is not part of the tab row.
- [ ] Run: `pnpm test:unit src/test/features/feeds/FeedList.test.tsx`

Expected: tab navigation matches the screenshot hierarchy.

## Task 3: Add View Selector To Add/Edit Feed Dialog

**Files:**

- Modify: `src/features/feeds/components/FeedDialog.tsx`
- Modify: `src/features/feeds/components/FeedDialogForm.tsx`
- Modify: `src/features/feeds/hooks/useFeedDialogForm.ts`
- Create: `src/features/feeds/components/FeedViewSelector.tsx`
- Test: `src/test/features/feeds/AddFeedDialog.test.tsx`

- [ ] Add `view` to `FeedDialogSubmitPayload`.
- [ ] Default view to `article`.
- [ ] Recommended Andrej Karpathy card applies `url`, `title`, `category = Recommended`, and `view = video`.
- [ ] Add a compact card/radio selector with the same order/icons as tabs.
- [ ] Make category remain a folder field, not a media type selector.
- [ ] Add tests:
  - add dialog shows the view selector.
  - choosing `视频` submits `view: 'video'`.
  - choosing recommended Andrej fills view as `video`.
  - category can still be independently changed.
- [ ] Run: `pnpm test:unit src/test/features/feeds/AddFeedDialog.test.tsx`

Expected: subscription creation captures view and category separately.

## Task 4: Render Video Timeline As Folo-Style Grid

**Files:**

- Modify: `src/features/articles/components/ArticleList.tsx`
- Create: `src/features/articles/components/VideoArticleGrid.tsx`
- Create: `src/features/articles/components/VideoArticleCard.tsx`
- Test: `src/test/features/articles/ArticleList.test.tsx`

- [ ] When selected view is video, bypass the compact middle-column card list and render a responsive grid.
- [ ] Use 16:9 thumbnails from YouTube or `previewImage`.
- [ ] Show duration badge when media attachment duration exists.
- [ ] Show title, feed title, and relative time below thumbnail.
- [ ] Keep click/keyboard selection behavior.
- [ ] Add tests:
  - video view renders grid cards.
  - video view does not render non-video articles.
  - clicking video card selects article.
  - card shows thumbnail and duration if available.
- [ ] Run: `pnpm test:unit src/test/features/articles/ArticleList.test.tsx`

Expected: video browsing visually matches Folo's grid pattern.

## Task 5: Discover / Recommended Feed Flow

**Files:**

- Modify: `src/features/feeds/components/FeedDialog.tsx`
- Modify: `src/features/feeds/recommendedFeeds.ts`
- Test: `src/test/features/feeds/AddFeedDialog.test.tsx`

- [ ] Move recommended feed cards into a Folo-like discover strip above the form.
- [ ] Cards show icon/title/source/category/view chip.
- [ ] Clicking a card fills URL/title/category/view and keeps the form editable.
- [ ] Keep direct `rsshub://` input accepted without remote validation.
- [ ] Add tests:
  - recommended cards render.
  - selecting Andrej sets `rsshub://youtube/user/@AndrejKarpathy` and `video`.
  - manual `rsshub://` can be submitted.
- [ ] Run: `pnpm test:unit src/test/features/feeds/AddFeedDialog.test.tsx`

Expected: add flow feels like Folo subscribe settings, not a plain URL form.

## Task 6: Verification

**Files:**

- No production files.

- [ ] Run focused tests:

```bash
pnpm test:unit src/test/features/feeds/FeedList.test.tsx src/test/features/feeds/AddFeedDialog.test.tsx src/test/features/articles/ArticleList.test.tsx src/test/app/api/feeds/routes.test.ts
```

- [ ] Run typecheck:

```bash
pnpm type-check
```

- [ ] Run lint:

```bash
pnpm lint
```

Expected: all commands exit 0. If the known jsdom `appStore.ts:772` stderr appears but tests pass, record it as existing noise.

---

## Important Correction From Previous Attempt

Do not keep the current `文章 / 图片 / 视频 / 社交` rows as-is. They should be migrated into a tab row. Because this is a behavior correction, remove or rewrite the prior smart-row implementation only after confirming with the user.

