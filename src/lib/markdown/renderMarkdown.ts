import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * 成稿 Markdown → 安全 HTML（客户端）。
 * 成稿是 LLM 半可信输出：marked 不消毒，这里再过一道 sanitize-html 白名单。
 */
export function renderMarkdownToSafeHtml(markdown: string): string {
  const raw = marked.parse(markdown ?? '', { async: false });
  return sanitizeHtml(raw, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'p', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'strong', 'em', 'del', 'hr', 'br', 'img', 'figure', 'figcaption', 'table',
      'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      code: ['class'],
      span: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noreferrer', target: '_blank' }),
    },
  });
}
