import { describe, expect, it } from 'vitest';
import {
  buildReleaseDedupeKey,
  buildReleaseTitle,
  parseRepoInput,
  toReleaseDraft,
  type GithubReleaseDraft,
} from '@/server/integrations/github/githubResourceMapper';
import { ValidationError } from '@/server/infra/http/errors';

describe('parseRepoInput', () => {
  it('parses owner/repo', () => {
    const ref = parseRepoInput('facebook/react');
    expect(ref).toMatchObject({ owner: 'facebook', repo: 'react', fullName: 'facebook/react' });
    expect(ref.htmlUrl).toBe('https://github.com/facebook/react');
  });

  it('parses https url with .git suffix and trailing slash', () => {
    const ref = parseRepoInput('https://github.com/facebook/react.git/');
    expect(ref).toMatchObject({ owner: 'facebook', repo: 'react' });
  });

  it('parses git@ scp-like syntax', () => {
    const ref = parseRepoInput('git@github.com:facebook/react.git');
    expect(ref).toMatchObject({ owner: 'facebook', repo: 'react' });
  });

  it('parses url with query string', () => {
    const ref = parseRepoInput('https://github.com/facebook/react?tab=releases');
    expect(ref).toMatchObject({ owner: 'facebook', repo: 'react' });
  });

  it('rejects non-github host', () => {
    expect(() => parseRepoInput('https://gitlab.com/owner/repo')).toThrow(ValidationError);
  });

  it('rejects empty input', () => {
    expect(() => parseRepoInput('')).toThrow(ValidationError);
  });

  it('rejects bare string without slash', () => {
    expect(() => parseRepoInput('foobar')).toThrow(ValidationError);
  });
});

describe('buildReleaseDedupeKey', () => {
  it('uses github:release prefix', () => {
    expect(buildReleaseDedupeKey(123)).toBe('github:release:123');
    expect(buildReleaseDedupeKey('9')).toBe('github:release:9');
  });
});

describe('buildReleaseTitle', () => {
  it('prefers name over tag_name', () => {
    expect(buildReleaseTitle({ name: 'React 19', tagName: 'v19.0.0' } as never)).toBe('React 19');
  });

  it('falls back to tag_name', () => {
    expect(buildReleaseTitle({ name: null, tagName: 'v19.0.0' } as never)).toBe('v19.0.0');
  });

  it('falls back to Release tag when both missing', () => {
    expect(buildReleaseTitle({ name: null, tagName: null, id: 5 } as never)).toBe('Release 5');
  });
});

describe('toReleaseDraft', () => {
  const release = {
    id: 42,
    tagName: 'v1.0.0',
    name: 'First',
    body: '# title',
    bodyHtml: '<h1>title</h1>',
    htmlUrl: 'https://github.com/o/r/releases/tag/v1.0.0',
    isPrerelease: false,
    isDraft: false,
    publishedAt: '2024-05-01T00:00:00Z',
    authorLogin: 'alice',
  } as never;

  it('projects a release into a draft via injected renderBody', () => {
    const renderBody = (input: { bodyHtml?: string | null; bodyMarkdown?: string | null }) =>
      input.bodyHtml ?? input.bodyMarkdown ?? '';

    const draft: GithubReleaseDraft = toReleaseDraft(release, { renderBody });

    expect(draft.ghId).toBe('42');
    expect(draft.ghType).toBe('release');
    expect(draft.dedupeKey).toBe('github:release:42');
    expect(draft.title).toBe('First');
    expect(draft.tagName).toBe('v1.0.0');
    expect(draft.author).toBe('alice');
    expect(draft.contentHtml).toBe('<h1>title</h1>');
    expect(draft.bodyMarkdown).toBe('# title');
    expect(draft.htmlUrl).toBe('https://github.com/o/r/releases/tag/v1.0.0');
    expect(draft.isPrerelease).toBe(false);
    expect(draft.isDraft).toBe(false);
    expect(draft.publishedAt).toBe('2024-05-01T00:00:00Z');
  });

  it('falls back to body_markdown when body_html is absent', () => {
    const renderBody = (input: { bodyHtml?: string | null; bodyMarkdown?: string | null }) =>
      input.bodyHtml ?? input.bodyMarkdown ?? '';

    const draft = toReleaseDraft(
      { ...release, bodyHtml: null } as never,
      { renderBody },
    );
    expect(draft.contentHtml).toBe('# title');
  });
});
