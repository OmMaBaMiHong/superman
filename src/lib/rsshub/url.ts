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

export function resolveFeedFetchUrl(value: string): string {
  return value;
}
