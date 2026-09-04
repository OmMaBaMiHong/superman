import { describe, expect, it } from 'vitest';
import { renderReleaseBody } from '@/server/integrations/github/githubMarkdown';

describe('renderReleaseBody', () => {
  it('prefers GitHub server-rendered body_html and sanitizes it', () => {
    const html = renderReleaseBody({
      bodyHtml: '<h1>Release</h1><script>alert(1)</script>',
      bodyMarkdown: '# should-not-be-used',
    });
    expect(html).toContain('<h1>Release</h1>');
    expect(html).not.toContain('<script>');
  });

  it('falls back to marked rendering when body_html is absent', () => {
    const html = renderReleaseBody({ bodyMarkdown: '# Hello\n\n- a\n- b' });
    expect(html).toContain('<h1');
    expect(html).toContain('<li>a</li>');
  });

  it('renders GFM tables', () => {
    const html = renderReleaseBody({
      bodyMarkdown: '| a | b |\n| - | - |\n| 1 | 2 |',
    });
    expect(html).toContain('<table>');
  });

  it('strips javascript: links and inline event handlers', () => {
    const html = renderReleaseBody({
      bodyHtml: '<a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)">',
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onerror');
  });

  it('returns empty string when both sources are empty', () => {
    expect(renderReleaseBody({ bodyHtml: '', bodyMarkdown: '' })).toBe('');
    expect(renderReleaseBody({})).toBe('');
  });

  it('uses provided baseUrl for relative link rewriting', () => {
    const html = renderReleaseBody({
      bodyMarkdown: '[docs](./docs)',
      baseUrl: 'https://github.com/o/r',
    });
    expect(html).toContain('https://github.com/o/r/docs');
  });
});
