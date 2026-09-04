import { marked } from 'marked';
import { sanitizeContent } from '@/server/integrations/rss/sanitizeContent';

/**
 * GitHub Release 正文渲染。
 *
 * ADR-07 策略：`body_html`（GitHub 服务端 GFM 渲染，随 `full+json` 媒体类型返回）
 * 优先；兜底用 `marked` 本地渲染原始 Markdown；两条路径最后都过现有
 * `sanitizeContent()` 收口，确保 XSS 兜底一致。
 *
 * GFM 表格 / 任务列表 / 删除线等在模块加载时全局开启，避免每次调用重复配置。
 */
marked.use({ gfm: true, breaks: false });

export interface RenderReleaseBodyInput {
  /** GitHub 服务端渲染的 HTML（优先级最高）。 */
  bodyHtml?: string | null;
  /** 原始 Markdown（兜底用）。 */
  bodyMarkdown?: string | null;
  /** 用于重写相对链接的基准地址，默认 github.com。 */
  baseUrl?: string | null;
}

function renderMarkdown(markdown: string): string {
  // marked v16 默认同步返回 string；强制断言类型，避免异步分支污染调用方签名。
  return marked.parse(markdown) as string;
}

/**
 * 渲染单条 Release 正文。
 *
 * 空正文（既无 `body_html` 也无 `body_markdown`）返回空字符串，
 * 调用方据此决定是否跳过该条 Release 的落库。
 */
export function renderReleaseBody(input: RenderReleaseBodyInput): string {
  const normalizedBase = input.baseUrl?.trim() || 'https://github.com';
  const baseUrl = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;

  const serverHtml = input.bodyHtml?.trim();
  if (serverHtml) {
    return sanitizeContent(serverHtml, { baseUrl });
  }

  const markdown = input.bodyMarkdown?.trim();
  if (!markdown) {
    return '';
  }

  const rendered = renderMarkdown(markdown);
  if (!rendered?.trim()) {
    return '';
  }

  return sanitizeContent(rendered, { baseUrl });
}
