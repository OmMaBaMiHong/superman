type RssHubApp = {
  fetch: (request: Request) => Response | Promise<Response>;
};

type RssHubAppModule = {
  default: RssHubApp;
};

declare global {
  var __feedfuseImportRssHubApp: (() => Promise<RssHubAppModule>) | undefined;
}

let appPromise: Promise<RssHubApp> | null = null;

function applyEmbeddedRssHubEnvDefaults() {
  process.env.CACHE_TYPE ??= 'memory';
  process.env.RSSHUB_EMBEDDED ??= '1';
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

function importRssHubApp(): Promise<RssHubAppModule> {
  if (globalThis.__feedfuseImportRssHubApp) {
    return globalThis.__feedfuseImportRssHubApp();
  }

  const nativeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<RssHubAppModule>;
  return nativeImport('rsshub/app');
}

async function getEmbeddedRssHubApp(): Promise<RssHubApp> {
  if (!appPromise) {
    applyEmbeddedRssHubEnvDefaults();
    appPromise = importRssHubApp().then((mod) => mod.default);
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
