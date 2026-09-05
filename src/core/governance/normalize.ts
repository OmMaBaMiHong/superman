/**
 * 治理 v2 ① 归一化（纯函数）。
 *
 * 学 hotspot-tracking-system 的做法，按 Postgres/JS 语境落地：
 *   - 标题：Unicode NFKC（全角半角统一、兼容字符折叠）→ 小写 →
 *     去全部空白 → 去标点/符号/emoji。归一化后相同即视为同一事件
 *     （跨平台合并语义：多平台热搜的同一事件标题只差表情/标点/全半角）。
 *   - URL：剥离 utm_* / spm / fbclid / gclid 等追踪参数与 hash，
 *     避免同一文章带不同追踪串被当成两篇。
 */

/** 常见追踪参数（utm_* 前缀单独判断）。 */
const TRACKING_PARAMS = new Set([
  'spm',
  'fbclid',
  'gclid',
  'dclid',
  'igshid',
  'ref',
  'ref_src',
  'mc_cid',
  'mc_eid',
  '_bds',
  'from',
]);

/**
 * 标题归一化：NFKC + 小写 + 去空白 + 去标点/符号（含 emoji）。
 * 比 dedup.ts 旧版 normalizeTitle 多了 NFKC 一层（全角ＡＢＣ → abc）。
 */
export function normalizeHeadline(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}]+/gu, '')
    .trim();
}

/** URL 归一化：去追踪参数与 hash。非法 URL 原样返回（trim 后）。 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  return url.toString();
}
