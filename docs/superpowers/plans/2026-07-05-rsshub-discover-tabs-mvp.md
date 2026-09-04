# RSSHub Discover Tabs MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FeedFuse feel closer to Folo for the first local MVP by completing RSSHub subscription discovery, recommended feeds, and left-rail content view tabs.

**Architecture:** Keep FeedFuse as the product shell and backend. RSSHub stays an internal adapter reachable through `rsshub://` and `/api/rsshub/*`; Folo is only the UI reference. Add small focused UI/state helpers instead of rewiring the reader store.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand store, Vitest, Testing Library, local RSSHub process adapter.

---

### Task 1: Folo-Style Left View Tabs

**Files:**
- Modify: `src/features/feeds/components/FeedViewTabs.tsx`
- Test: `src/test/features/feeds/FeedList.test.tsx`

- [ ] **Step 1: Write the failing test**

Add assertions that `feed-view-tabs` is a horizontal tablist and that tab buttons use `role="tab"` with selected state.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/test/features/feeds/FeedList.test.tsx -t "renders Folo-style view tabs as a horizontal tablist"`

- [ ] **Step 3: Write minimal implementation**

Change `FeedViewTabs` from a 6-column icon grid to a horizontal segmented tablist. Keep existing tab IDs, counts, and selection behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit src/test/features/feeds/FeedList.test.tsx -t "view tabs"`

### Task 2: RSSHub Discover-First Add Feed Dialog

**Files:**
- Modify: `src/features/feeds/recommendedFeeds.ts`
- Modify: `src/features/feeds/components/FeedDialog.tsx`
- Modify: `src/features/feeds/components/FeedDialogForm.tsx`
- Modify: `src/features/feeds/hooks/useFeedDialogForm.ts`
- Test: `src/test/features/feeds/AddFeedDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Add assertions that the add dialog shows a Discover search box, detects `rsshub://` input as "内置 RSSHub", and separates recommended feeds into RSSHub / RSS sections.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/test/features/feeds/AddFeedDialog.test.tsx -t "shows RSSHub native discovery"`

- [ ] **Step 3: Write minimal implementation**

Add `sourceType` metadata to recommendations, render a Folo-like discover panel at the top of the dialog, and expose the detected input type from `useFeedDialogForm`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit src/test/features/feeds/AddFeedDialog.test.tsx -t "RSSHub|recommended|add dialog"`

### Task 3: RSSHub Health Status

**Files:**
- Create: `src/app/api/rsshub/status/route.ts`
- Modify: `src/features/feeds/components/FeedDialog.tsx`
- Test: `src/test/app/api/rsshub/status.route.test.ts`
- Test: `src/test/features/feeds/AddFeedDialog.test.tsx`

- [ ] **Step 1: Write the failing API test**

Assert `/api/rsshub/status` returns the configured base URL and availability.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/test/app/api/rsshub/status.route.test.ts`

- [ ] **Step 3: Write minimal implementation**

Implement a small status route using `ensureInternalRssHubAvailable()` and `getRssHubBaseUrl()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit src/test/app/api/rsshub/status.route.test.ts`

### Task 4: Verification

- [ ] Run `pnpm test:unit src/test/features/feeds/FeedList.test.tsx src/test/features/feeds/AddFeedDialog.test.tsx src/test/app/api/rsshub/status.route.test.ts`
- [ ] Run `pnpm type-check`
- [ ] Run `pnpm lint`
