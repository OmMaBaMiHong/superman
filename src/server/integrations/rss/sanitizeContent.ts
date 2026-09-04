import sanitizeHtml from 'sanitize-html';

const HTTP_PROTOCOLS = ['http:', 'https:'] as const;
const SANITIZE_HTML_HTTP_SCHEMES = ['http', 'https'];
const TRACK_KINDS = ['subtitles', 'captions', 'descriptions', 'chapters', 'metadata'] as const;
const VIDEO_PRELOAD_VALUES = ['none', 'metadata', 'auto'] as const;
const VIDEO_CROSSORIGIN_VALUES = ['anonymous', 'use-credentials'] as const;
const VIDEO_CONTROLS_LIST_TOKENS = new Set(['nodownload', 'nofullscreen', 'noremoteplayback']);

const allowedTags = [...sanitizeHtml.defaults.allowedTags, 'img', 'video', 'source', 'track'];

const allowedAttributes: sanitizeHtml.IOptions['allowedAttributes'] = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
  // 抖音工作台：允许 RSSHub 注入的视频统计标记（播放/点赞/评论/分享/收藏），供仪表盘解析。
  div: ['data-douyin-stats', 'style'],
  source: ['src', 'type'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  track: ['src', 'kind', 'srclang', 'label', 'default'],
  video: [
    'src',
    'poster',
    'width',
    'height',
    'controls',
    'preload',
    'playsinline',
    'muted',
    'loop',
    'controlslist',
    'crossorigin',
  ],
};

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeUrl(value: string, base: URL | null): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  try {
    return base ? new URL(normalized, base) : new URL(normalized);
  } catch {
    return null;
  }
}

function isAllowedScheme(url: URL, allowed: readonly string[]): boolean {
  return allowed.includes(url.protocol);
}

function mergeRel(existing: string | undefined, required: string[]): string {
  const tokens = new Set<string>();
  (existing ?? '')
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .forEach((token) => tokens.add(token));

  required.forEach((token) => tokens.add(token));
  return Array.from(tokens).join(' ');
}

function normalizeSrcset(value: string, base: URL | null): string | null {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const normalized = parts
    .map((part) => {
      const [rawUrl, ...descriptorParts] = part.split(/\s+/);
      if (!rawUrl) return null;
      const url = normalizeUrl(rawUrl, base);
      if (!url) return null;
      if (!isAllowedScheme(url, HTTP_PROTOCOLS)) return null;

      const descriptor = descriptorParts.join(' ').trim();
      return descriptor ? `${url.toString()} ${descriptor}` : url.toString();
    })
    .filter((item): item is string => Boolean(item));

  return normalized.length ? normalized.join(', ') : null;
}

function normalizeNumeric(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

function normalizeBooleanAttribute(
  value: string | undefined,
  attributeName: string,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().toLowerCase();
  return !trimmed || trimmed === attributeName || trimmed === 'true' ? attributeName : undefined;
}

function normalizeToken(value: string | undefined, allowed: readonly string[]): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && allowed.includes(trimmed) ? trimmed : undefined;
}

function normalizeMediaUrlAttribute(
  value: string | undefined,
  base: URL | null,
): string | undefined {
  const url = value?.trim() ? normalizeUrl(value, base) : null;
  return url && isAllowedScheme(url, HTTP_PROTOCOLS) ? url.toString() : undefined;
}

function normalizeControlsList(value: string | undefined): string | undefined {
  const normalized = value
    ?.split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => VIDEO_CONTROLS_LIST_TOKENS.has(token))
    .join(' ');

  return normalized || undefined;
}

export function sanitizeContent(
  html: string | null | undefined,
  options: { baseUrl: string } | undefined = undefined,
): string | null {
  if (!html) return null;

  const base = options?.baseUrl ? parseUrl(options.baseUrl) : null;

  const cleaned = sanitizeHtml(html, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: SANITIZE_HTML_HTTP_SCHEMES,
      source: SANITIZE_HTML_HTTP_SCHEMES,
      track: SANITIZE_HTML_HTTP_SCHEMES,
      video: SANITIZE_HTML_HTTP_SCHEMES,
    },
    allowProtocolRelative: false,
    exclusiveFilter: (frame) =>
      (frame.tag === 'img' && !frame.attribs.src) ||
      (frame.tag === 'source' && !frame.attribs.src) ||
      (frame.tag === 'track' && !frame.attribs.src) ||
      (frame.tag === 'video' && !frame.attribs.src && !frame.mediaChildren.includes('source')),
    transformTags: {
      a: (tagName: string, attribs: sanitizeHtml.Attributes) => {
        const href = attribs.href?.trim();
        if (!href) {
          return { tagName, attribs };
        }

        if (href.startsWith('#')) {
          const rest: sanitizeHtml.Attributes = { ...attribs, href };
          delete rest['target'];
          delete rest['rel'];
          return { tagName, attribs: rest };
        }

        const url = normalizeUrl(href, base);
        if (!url) {
          const rest: sanitizeHtml.Attributes = { ...attribs };
          delete rest['href'];
          return { tagName, attribs: rest };
        }

        if (!isAllowedScheme(url, [...HTTP_PROTOCOLS, 'mailto:'])) {
          const rest: sanitizeHtml.Attributes = { ...attribs };
          delete rest['href'];
          return { tagName, attribs: rest };
        }

        if (url.protocol === 'mailto:') {
          const rest: sanitizeHtml.Attributes = { ...attribs, href: url.toString() };
          delete rest['target'];
          delete rest['rel'];
          return { tagName, attribs: rest };
        }

        return {
          tagName,
          attribs: {
            ...attribs,
            href: url.toString(),
            target: '_blank',
            rel: mergeRel(attribs.rel, ['noopener', 'noreferrer', 'ugc']),
          },
        };
      },
      img: (tagName: string, attribs: sanitizeHtml.Attributes) => {
        const rawSrc = (attribs.src ?? attribs['data-src'] ?? '').trim();
        const srcUrl = rawSrc ? normalizeUrl(rawSrc, base) : null;
        const src =
          srcUrl && isAllowedScheme(srcUrl, HTTP_PROTOCOLS) ? srcUrl.toString() : undefined;

        const rawSrcset = (attribs.srcset ?? attribs['data-srcset'] ?? '').trim();
        const srcset = rawSrcset ? normalizeSrcset(rawSrcset, base) ?? undefined : undefined;

        const width = normalizeNumeric(attribs.width);
        const height = normalizeNumeric(attribs.height);

        return {
          tagName,
          attribs: {
            ...(src ? { src } : {}),
            ...(srcset ? { srcset } : {}),
            ...(attribs.alt ? { alt: attribs.alt } : {}),
            ...(attribs.title ? { title: attribs.title } : {}),
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
            loading: attribs.loading?.trim() ? attribs.loading : 'lazy',
            decoding: attribs.decoding?.trim() ? attribs.decoding : 'async',
          },
        };
      },
      source: (tagName: string, attribs: sanitizeHtml.Attributes) => {
        const src = normalizeMediaUrlAttribute(attribs.src, base);

        return {
          tagName,
          attribs: {
            ...(src ? { src } : {}),
            ...(attribs.type?.trim() ? { type: attribs.type.trim() } : {}),
          },
        };
      },
      track: (tagName: string, attribs: sanitizeHtml.Attributes) => {
        const src = normalizeMediaUrlAttribute(attribs.src, base);
        const kind = normalizeToken(attribs.kind, TRACK_KINDS);
        const srclang = attribs.srclang?.trim();
        const label = attribs.label?.trim();
        const defaultValue = normalizeBooleanAttribute(attribs.default, 'default');

        return {
          tagName,
          attribs: {
            ...(src ? { src } : {}),
            ...(kind ? { kind } : {}),
            ...(srclang ? { srclang } : {}),
            ...(label ? { label } : {}),
            ...(defaultValue ? { default: defaultValue } : {}),
          },
        };
      },
      video: (tagName: string, attribs: sanitizeHtml.Attributes) => {
        const src = normalizeMediaUrlAttribute(attribs.src, base);
        const poster = normalizeMediaUrlAttribute(attribs.poster, base);
        const width = normalizeNumeric(attribs.width);
        const height = normalizeNumeric(attribs.height);
        const preload = normalizeToken(attribs.preload, VIDEO_PRELOAD_VALUES);
        const playsinline = normalizeBooleanAttribute(attribs.playsinline, 'playsinline');
        const muted = normalizeBooleanAttribute(attribs.muted, 'muted');
        const loop = normalizeBooleanAttribute(attribs.loop, 'loop');
        const controlsList = normalizeControlsList(attribs.controlslist);
        const crossorigin = normalizeToken(attribs.crossorigin, VIDEO_CROSSORIGIN_VALUES);

        return {
          tagName,
          attribs: {
            ...(src ? { src } : {}),
            ...(poster ? { poster } : {}),
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
            controls: 'controls',
            ...(preload ? { preload } : {}),
            ...(playsinline ? { playsinline } : {}),
            ...(muted ? { muted } : {}),
            ...(loop ? { loop } : {}),
            ...(controlsList ? { controlslist: controlsList } : {}),
            ...(crossorigin ? { crossorigin } : {}),
          },
        };
      },
    },
  });

  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : null;
}
