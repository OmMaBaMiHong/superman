# Embedded RSSHub Hono One-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run full RSSHub functionality inside the FeedFuse Next process, exposing only the FeedFuse port while preserving RSSHub-native routes and responses.

**Architecture:** Copy RSSHub source into FeedFuse as `vendor/rsshub`, build RSSHub as a workspace package, and export its Hono app as `rsshub/app`. FeedFuse route handlers call RSSHub's `app.fetch(request)` directly instead of starting RSSHub's `@hono/node-server`, so RSSHub code is embedded but no RSSHub child process or second port exists.

**Tech Stack:** Next.js Route Handlers, RSSHub Hono app, TypeScript, pnpm workspace, Vitest.

---

## Correction From Previous Direction

Do not use a FeedFuse-side RSSHub `Data -> RSS XML` serializer. That would be a shortcut and can lose RSSHub behavior.

This plan keeps RSSHub behavior by returning RSSHub's own Hono `Response`, including:

- RSSHub XML rendering
- `format=json`, `format=atom`, `format=rss3`, and debug formats
- RSSHub middleware, cache, headers, ETag, redirects, and errors
- Native route behavior such as `/youtube/user/@AndrejKarpathy`

## Success Criteria

- `pnpm dev` starts FeedFuse only on `http://localhost:9559`.
- No RSSHub listener is required on `127.0.0.1:1200`.
- `/api/rsshub/youtube/user/@AndrejKarpathy` returns RSSHub's native XML response.
- `/api/rsshub/youtube/user/@AndrejKarpathy?format=json` returns RSSHub's native JSON response.
- Adding `rsshub://youtube/user/@AndrejKarpathy` validates and subscribes normally.
- Tests prove RSSHub integration does not call `spawn()` and does not fetch `http://127.0.0.1:1200`.

---

### Task 1: Vendor RSSHub and Export Its Hono App

**Files:**
- Create: `vendor/rsshub/`
- Modify: `vendor/rsshub/tsdown-lib.config.ts`
- Modify: `vendor/rsshub/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`

- [ ] **Step 1: Copy RSSHub source into FeedFuse**

Run:

```bash
mkdir -p vendor
rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude .turbo \
  --exclude .cache \
  --exclude dist \
  --exclude dist-lib \
  --exclude coverage \
  /Users/wade/work-space/RSSHub/ \
  vendor/rsshub/
```

Expected:

```text
vendor/rsshub/package.json exists
vendor/rsshub/lib/app.ts exists
vendor/rsshub/node_modules does not exist
```

- [ ] **Step 2: Build RSSHub package output with app export**

Update `vendor/rsshub/tsdown-lib.config.ts`:

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['./lib/pkg.ts', './lib/app.ts'],
    shims: true,
    clean: true,
    dts: true,
    copy: ['lib/assets'],
    outDir: 'dist-lib',
    deps: {
        onlyBundle: false,
    },
});
```

- [ ] **Step 3: Export the app entry from vendored RSSHub**

Update the `exports` field in `vendor/rsshub/package.json`:

```json
{
  "exports": {
    ".": {
      "types": "./dist-lib/pkg.d.mts",
      "import": "./dist-lib/pkg.mjs"
    },
    "./app": {
      "types": "./dist-lib/app.d.mts",
      "import": "./dist-lib/app.mjs"
    }
  }
}
```

- [ ] **Step 4: Add RSSHub to FeedFuse workspace**

Replace `pnpm-workspace.yaml` with:

```yaml
packages:
  - .
  - vendor/rsshub

allowBuilds:
  esbuild: true
  sharp: true
```

- [ ] **Step 5: Add FeedFuse dependency and build script**

Merge these entries into FeedFuse `package.json`:

```json
{
  "scripts": {
    "rsshub:build": "pnpm --dir vendor/rsshub build:lib",
    "dev": "pnpm rsshub:build && WATCHPACK_POLLING=true next dev --webpack -p 9559",
    "dev:turbo": "pnpm rsshub:build && next dev -p 9559",
    "build": "pnpm build:clean && pnpm rsshub:build && next build"
  },
  "dependencies": {
    "rsshub": "workspace:*"
  }
}
```

- [ ] **Step 6: Install and build**

Run:

```bash
pnpm install
pnpm rsshub:build
```

Expected:

```text
vendor/rsshub/dist-lib/app.mjs exists
vendor/rsshub/dist-lib/pkg.mjs exists
```

---

### Task 2: Add Embedded RSSHub Hono App Bridge

**Files:**
- Create: `src/server/integrations/rsshub/embeddedRssHubApp.ts`
- Test: `src/test/server/rsshub/embeddedRssHubApp.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Create `src/test/server/rsshub/embeddedRssHubApp.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appFetchMock = vi.hoisted(() => vi.fn());

vi.mock('rsshub/app', () => ({
  default: {
    fetch: (...args: unknown[]) => appFetchMock(...args),
  },
}));

describe('embedded RSSHub Hono app bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    appFetchMock.mockReset();
  });

  it('calls RSSHub app.fetch without opening a network port', async () => {
    appFetchMock.mockResolvedValue(new Response('<rss />', {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    }));

    const mod = await import('@/server/integrations/rsshub/embeddedRssHubApp');
    const response = await mod.fetchEmbeddedRssHubRoute('/youtube/user/@AndrejKarpathy?format=atom');

    expect(appFetchMock).toHaveBeenCalledTimes(1);
    const request = appFetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('http://embedded.rsshub.local/youtube/user/@AndrejKarpathy?format=atom');
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('<rss />');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test:unit src/test/server/rsshub/embeddedRssHubApp.test.ts
```

Expected: FAIL because `embeddedRssHubApp.ts` does not exist.

- [ ] **Step 3: Implement the bridge**

Create `src/server/integrations/rsshub/embeddedRssHubApp.ts`:

```ts
type RssHubApp = {
  fetch: (request: Request) => Response | Promise<Response>;
};

let appPromise: Promise<RssHubApp> | null = null;

function applyEmbeddedRssHubEnvDefaults() {
  process.env.CACHE_TYPE ??= 'memory';
  process.env.REQUEST_TIMEOUT ??= '30000';

  const proxyUri =
    process.env.RSSHUB_PROXY_URI ||
    process.env.PROXY_URI ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.ALL_PROXY;

  if (proxyUri && !process.env.PROXY_URI) {
    process.env.PROXY_URI = proxyUri;
  }
}

async function getEmbeddedRssHubApp(): Promise<RssHubApp> {
  if (!appPromise) {
    applyEmbeddedRssHubEnvDefaults();
    appPromise = import('rsshub/app').then((mod) => mod.default as RssHubApp);
  }

  return appPromise;
}

export async function ensureEmbeddedRssHubReady(): Promise<void> {
  await getEmbeddedRssHubApp();
}

export async function fetchEmbeddedRssHubRoute(
  routePath: string,
  init?: RequestInit,
): Promise<Response> {
  const app = await getEmbeddedRssHubApp();
  const request = new Request(new URL(routePath, 'http://embedded.rsshub.local').toString(), init);
  return app.fetch(request);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm test:unit src/test/server/rsshub/embeddedRssHubApp.test.ts
```

Expected: PASS.

---

### Task 3: Parse RSSHub URLs as In-Process Routes

**Files:**
- Modify: `src/lib/rsshub/url.ts`
- Test: `src/test/lib/rsshub/url.test.ts`

- [ ] **Step 1: Write failing URL helper tests**

Create or update `src/test/lib/rsshub/url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getRssHubRoutePath, isRssHubUrl, resolveRssHubApiPath } from '@/lib/rsshub/url';

describe('RSSHub URL helpers', () => {
  it('converts rsshub protocol URLs into RSSHub route paths', () => {
    expect(isRssHubUrl('rsshub://youtube/user/@AndrejKarpathy')).toBe(true);
    expect(getRssHubRoutePath('rsshub://youtube/user/@AndrejKarpathy')).toBe('/youtube/user/@AndrejKarpathy');
    expect(resolveRssHubApiPath('rsshub://youtube/user/@AndrejKarpathy')).toBe('/api/rsshub/youtube/user/@AndrejKarpathy');
  });

  it('keeps query strings', () => {
    expect(getRssHubRoutePath('rsshub://youtube/user/@AndrejKarpathy?format=json')).toBe(
      '/youtube/user/@AndrejKarpathy?format=json',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test:unit src/test/lib/rsshub/url.test.ts
```

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 3: Implement route helpers**

Update `src/lib/rsshub/url.ts`:

```ts
const RSSHUB_PROTOCOL = 'rsshub:';

function parseRssHubUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== RSSHUB_PROTOCOL || !parsed.hostname) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isRssHubUrl(value: string): boolean {
  return parseRssHubUrl(value) !== null;
}

export function getRssHubRoutePath(value: string): string | null {
  const parsed = parseRssHubUrl(value);
  if (!parsed) return null;
  return `/${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

export function resolveRssHubApiPath(value: string): string | null {
  const routePath = getRssHubRoutePath(value);
  if (!routePath) return null;
  return `/api/rsshub${routePath}`;
}
```

Do not keep `resolveRssHubUrl()` pointing at `127.0.0.1:1200`; that concept is removed.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm test:unit src/test/lib/rsshub/url.test.ts
```

Expected: PASS.

---

### Task 4: Serve `/api/rsshub/*` Through Embedded RSSHub

**Files:**
- Modify: `src/app/api/rsshub/[...route]/route.ts`
- Modify: `src/app/api/rsshub/status/route.ts`
- Test: `src/test/app/api/rsshub/route.test.ts`
- Test: `src/test/app/api/rsshub/status.route.test.ts`

- [ ] **Step 1: Write embedded route tests**

Update `src/test/app/api/rsshub/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchEmbeddedRssHubRouteMock = vi.fn();

vi.mock('@/server/integrations/rsshub/embeddedRssHubApp', () => ({
  fetchEmbeddedRssHubRoute: (...args: unknown[]) => fetchEmbeddedRssHubRouteMock(...args),
}));

describe('/api/rsshub/[...route]', () => {
  beforeEach(() => {
    fetchEmbeddedRssHubRouteMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('returns the native embedded RSSHub response without fetching port 1200', async () => {
    const globalFetchMock = vi.fn();
    vi.stubGlobal('fetch', globalFetchMock);
    fetchEmbeddedRssHubRouteMock.mockResolvedValue(new Response('<rss />', {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        etag: '"rsshub-etag"',
      },
    }));

    const mod = await import('../../../../app/api/rsshub/[...route]/route');
    const response = await mod.GET(
      new Request('http://localhost/api/rsshub/youtube/user/@AndrejKarpathy?format=atom'),
      { params: Promise.resolve({ route: ['youtube', 'user', '@AndrejKarpathy'] }) },
    );

    expect(fetchEmbeddedRssHubRouteMock).toHaveBeenCalledWith(
      '/youtube/user/@AndrejKarpathy?format=atom',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(globalFetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(response.headers.get('etag')).toBe('"rsshub-etag"');
    await expect(response.text()).resolves.toBe('<rss />');
  });
});
```

Update `src/test/app/api/rsshub/status.route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureEmbeddedRssHubReadyMock = vi.fn();

vi.mock('@/server/integrations/rsshub/embeddedRssHubApp', () => ({
  ensureEmbeddedRssHubReady: (...args: unknown[]) => ensureEmbeddedRssHubReadyMock(...args),
}));

describe('/api/rsshub/status', () => {
  beforeEach(() => {
    ensureEmbeddedRssHubReadyMock.mockReset();
  });

  it('reports embedded RSSHub readiness without a baseUrl port', async () => {
    ensureEmbeddedRssHubReadyMock.mockResolvedValue(undefined);

    const mod = await import('../../../../app/api/rsshub/status/route');
    const response = await mod.GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      data: {
        available: true,
        mode: 'embedded',
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test:unit src/test/app/api/rsshub/route.test.ts src/test/app/api/rsshub/status.route.test.ts
```

Expected: FAIL because current code still uses the old internal service and base URL.

- [ ] **Step 3: Implement embedded API route**

Update `src/app/api/rsshub/[...route]/route.ts`:

```ts
import { fetchEmbeddedRssHubRoute } from '@/server/integrations/rsshub/embeddedRssHubApp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RssHubRouteContext {
  params: Promise<{
    route: string[];
  }>;
}

function encodeRouteSegment(segment: string): string {
  return encodeURIComponent(segment).replaceAll('%40', '@');
}

export async function GET(request: Request, context: RssHubRouteContext) {
  const params = await context.params;
  const incomingUrl = new URL(request.url);
  const routePath = `/${params.route.map(encodeRouteSegment).join('/')}${incomingUrl.search}`;

  return fetchEmbeddedRssHubRoute(routePath, {
    headers: request.headers,
  });
}
```

Update `src/app/api/rsshub/status/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { ensureEmbeddedRssHubReady } from '@/server/integrations/rsshub/embeddedRssHubApp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Embedded RSSHub is not ready';
}

export async function GET() {
  try {
    await ensureEmbeddedRssHubReady();
    return NextResponse.json({
      ok: true,
      data: {
        available: true,
        mode: 'embedded',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        data: {
          available: false,
          mode: 'embedded',
        },
        error: {
          code: 'rsshub_unavailable',
          message: getErrorMessage(error),
        },
      },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test:unit src/test/app/api/rsshub/route.test.ts src/test/app/api/rsshub/status.route.test.ts
```

Expected: PASS.

---

### Task 5: Fetch `rsshub://` Subscriptions Through Embedded RSSHub

**Files:**
- Modify: `src/server/integrations/rss/fetchFeedXml.ts`
- Modify: `src/app/api/rss/validate/route.ts`
- Test: `src/test/server/rss/fetchFeedXml.test.ts`
- Test: `src/test/app/api/rss/validate/route.test.ts`

- [ ] **Step 1: Write fetch test proving no port proxy**

In `src/test/server/rss/fetchFeedXml.test.ts`, mock `fetchEmbeddedRssHubRoute`:

```ts
const fetchEmbeddedRssHubRouteMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/integrations/rsshub/embeddedRssHubApp', () => ({
  fetchEmbeddedRssHubRoute: (...args: unknown[]) => fetchEmbeddedRssHubRouteMock(...args),
}));
```

Add this test:

```ts
it('fetches rsshub protocol feeds from embedded RSSHub without port 1200', async () => {
  fetchEmbeddedRssHubRouteMock.mockResolvedValue(new Response('<rss><channel><title>Andrej</title></channel></rss>', {
    status: 200,
    headers: {
      etag: '"embedded-etag"',
      'last-modified': 'Tue, 07 Jul 2026 00:00:00 GMT',
    },
  }));

  const result = await mod.fetchFeedXml('rsshub://youtube/user/@AndrejKarpathy', {
    timeoutMs: 10_000,
    userAgent: 'FeedFuse Test',
  });

  expect(fetchEmbeddedRssHubRouteMock).toHaveBeenCalledWith(
    '/youtube/user/@AndrejKarpathy',
    expect.objectContaining({ headers: expect.any(Headers) }),
  );
  expect(fetchRssXmlMock).not.toHaveBeenCalled();
  expect(result).toEqual({
    status: 200,
    xml: '<rss><channel><title>Andrej</title></channel></rss>',
    etag: '"embedded-etag"',
    lastModified: 'Tue, 07 Jul 2026 00:00:00 GMT',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test:unit src/test/server/rss/fetchFeedXml.test.ts
```

Expected: FAIL because current code still resolves RSSHub URLs to `127.0.0.1:1200`.

- [ ] **Step 3: Implement embedded fetch path**

Update `src/server/integrations/rss/fetchFeedXml.ts` so `rsshub://` uses `fetchEmbeddedRssHubRoute()` and ordinary RSS URLs still use `fetchRssXml()`.

Use this RSSHub branch:

```ts
if (isRssHubUrl(url)) {
  const routePath = getRssHubRoutePath(url);
  if (!routePath) {
    return { status: 400, xml: null, etag: null, lastModified: null };
  }

  const headers = new Headers({
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    'user-agent': options.userAgent,
  });
  if (options.etag) headers.set('if-none-match', options.etag);
  if (options.lastModified) headers.set('if-modified-since', options.lastModified);

  const response = await fetchEmbeddedRssHubRoute(routePath, { headers });
  return {
    status: response.status,
    xml: response.status === 304 ? null : await response.text(),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}
```

- [ ] **Step 4: Update validation route**

In `src/app/api/rss/validate/route.ts`:

- Remove `resolveFeedFetchUrl` import.
- Remove `ensureInternalRssHubAvailable` import.
- Add `fetchFeedXml` import.
- In the `try` block, branch for `rssHubUrl` before normal `fetchRssXml`.

Use:

```ts
if (rssHubUrl) {
  const res = await fetchFeedXml(normalizedUrl, {
    timeoutMs: 10_000,
    userAgent: 'FeedFuse RSS Validator',
  });

  if (res.status < 200 || res.status >= 300 || !res.xml) {
    return toJson({
      valid: false,
      reason: 'not_feed',
      message: '无法从内置 RSSHub 获取订阅内容',
    });
  }

  const xml = res.xml;
  const kind = detectKind(xml);
  const feed = await parser.parseString(xml);
  const parsedSiteUrl = normalizeHttpUrl(feed.link);

  return toJson({
    valid: true,
    kind,
    title: feed.title,
    siteUrl: parsedSiteUrl ?? undefined,
  });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test:unit src/test/server/rss/fetchFeedXml.test.ts src/test/app/api/rss/validate/route.test.ts
```

Expected: PASS.

---

### Task 6: Retire Child Process Integration

**Files:**
- Modify: `src/server/integrations/rsshub/internalRssHubService.ts`
- Modify: `src/test/server/rsshub/internalRssHubService.test.ts`

- [ ] **Step 1: Replace old service with compatibility exports**

Update `src/server/integrations/rsshub/internalRssHubService.ts`:

```ts
export {
  ensureEmbeddedRssHubReady as ensureInternalRssHubAvailable,
  fetchEmbeddedRssHubRoute,
} from './embeddedRssHubApp';
```

- [ ] **Step 2: Replace old spawn tests**

Update `src/test/server/rsshub/internalRssHubService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('internal RSSHub compatibility service', () => {
  it('exports embedded RSSHub helpers without child-process startup', async () => {
    const mod = await import('@/server/integrations/rsshub/internalRssHubService');

    expect(mod.ensureInternalRssHubAvailable).toBeTypeOf('function');
    expect(mod.fetchEmbeddedRssHubRoute).toBeTypeOf('function');
  });
});
```

- [ ] **Step 3: Prove child-process/port code is gone**

Run:

```bash
grep -RIn "spawn\\|RSSHUB_BASE_URL\\|RSSHUB_AUTOSTART\\|127.0.0.1:1200\\|node_modules/.bin/tsx" src/server src/app src/lib
```

Expected: no RSSHub child-process or port-proxy matches.

---

### Task 7: Full Verification

**Files:**
- No code files unless verification finds a bug.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test:unit src/test/server/rsshub src/test/app/api/rsshub src/test/server/rss/fetchFeedXml.test.ts src/test/app/api/rss/validate/route.test.ts src/test/features/feeds/AddFeedDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run quality gates**

Run:

```bash
pnpm type-check
pnpm lint
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Manual one-port smoke test**

Run:

```bash
pnpm dev
```

In another terminal:

```bash
curl -i 'http://localhost:9559/api/rsshub/youtube/user/@AndrejKarpathy' | head -40
curl -i 'http://localhost:9559/api/rsshub/youtube/user/@AndrejKarpathy?format=json' | head -40
lsof -nP -iTCP:1200 -sTCP:LISTEN
```

Expected:

```text
The first curl returns RSS/XML.
The second curl returns RSSHub JSON format.
lsof shows no RSSHub process started by FeedFuse on port 1200.
```

- [ ] **Step 4: Manual subscription smoke test**

Open `http://localhost:9559`, add:

```text
rsshub://youtube/user/@AndrejKarpathy
```

Expected:

```text
The dialog recognizes RSSHub.
Save succeeds.
The feed appears in the left sidebar.
Refresh fetches entries through the embedded app.
Only port 9559 is used.
```

## Self-Review

**Spec coverage:** This corrected plan embeds RSSHub code, preserves RSSHub native functionality, supports `rsshub://` subscriptions, and exposes only the FeedFuse port.

**Placeholder scan:** No serializer workaround remains.

**Type consistency:** The plan consistently uses `fetchEmbeddedRssHubRoute()`, `ensureEmbeddedRssHubReady()`, and `getRssHubRoutePath()`.
