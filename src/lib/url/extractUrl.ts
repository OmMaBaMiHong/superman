/**
 * 从杂乱文本中提取真实链接。
 *
 * 抖音/小红书等分享文案形如：
 *   "1.53 :1pm lPK:/ 05/08 V@L.wS 开源项目graft… # codex # aiagent  https://v.douyin.com/Y1XslSyYW2s/ 复制此链接，打开抖音搜索…"
 * 用户往往整段粘贴，需要从中精准取出 URL。
 */

/** 从文本中提取第一个 http(s) 链接（去掉尾部标点）。 */
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  // 匹配 http(s)://… 直到空白或中文标点/常见收尾符号
  const m = text.match(/https?:\/\/[^\s，。！？、；：""''（）【】《》「」]+/i);
  if (!m) return null;
  // 去掉尾部可能粘连的标点
  const url = m[0].replace(/[.,;:!?)\]}>，。！？、；：）】》」]+$/u, '');
  return url;
}

/** 文本里是否含链接。 */
export function hasUrl(text: string): boolean {
  return extractFirstUrl(text) !== null;
}

/**
 * 规范化用户输入为「可识别的链接」：
 *   - rsshub:// 协议 → 原样返回
 *   - 纯 http(s) URL → 原样返回
 *   - 含链接的整段文字 → 提取其中的 URL
 *   - 都不匹配 → 返回 trim 后的原文（交给下游报格式错误）
 */
export function normalizeUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^rsshub:\/\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
  const extracted = extractFirstUrl(trimmed);
  return extracted ?? trimmed;
}
