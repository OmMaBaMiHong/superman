import { ValidationError } from '@/server/infra/http/errors';
import type { GithubRelease } from '@/server/integrations/github/githubSchemas';

/**
 * GitHub 资源 → 领域对象映射。
 *
 * 职责：
 * - `parseRepoInput`：把「`owner/repo` / 完整 URL / `git@` 形式」统一归一化成 `{owner, repo}`
 * - `buildReleaseDedupeKey`：生成 `articles.dedupe_key`，和 RSS 的 `guid:` 家族区分开
 * - `buildReleaseTitle` / `toReleaseDraft`：把 API Release 投影成可落库的 `GithubReleaseDraft`
 *
 * 设计要点：`toReleaseDraft` 不耦合 `githubMarkdown`，而是注入 `ctx.renderBody`，
 * 这样单测可以传一个纯函数断言而不必真的跑一遍 sanitizer/marked。
 */

export interface ParsedRepoRef {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
}

const GITHUB_HOST_PATTERN = /(^|\.)github\.com$/i;

/**
 * 归一化任意形态的仓库标识。
 *
 * 支持：
 * - `owner/repo`
 * - `https://github.com/owner/repo(.git)?`
 * - `git@github.com:owner/repo.git`
 * - 带尾斜杠、带查询串、大小写混合
 *
 * 任何无法解析出 `owner/repo` 的输入都抛 `ValidationError`，由上层路由翻译成 400。
 */
export function parseRepoInput(raw: string): ParsedRepoRef {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new ValidationError('Invalid GitHub repository', { repo: '仓库地址不能为空' });
  }

  let owner = '';
  let repo = '';

  // 1) git@ scp 形式：git@github.com:owner/repo(.git)
  const sshMatch = trimmed.match(/^git@([^/:]+):(.+)$/i);
  if (sshMatch && GITHUB_HOST_PATTERN.test(sshMatch[1])) {
    const segments = stripGitSuffix(sshMatch[2]).split('/').filter(Boolean);
    if (segments.length >= 2) {
      owner = segments[0];
      repo = segments[1];
    }
  } else if (/^https?:\/\//i.test(trimmed) || trimmed.includes('github.com')) {
    // 2) 完整 URL
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex > 0) {
      const host = withoutScheme.slice(0, slashIndex);
      const path = withoutScheme.slice(slashIndex + 1);
      if (GITHUB_HOST_PATTERN.test(host)) {
        const segments = stripGitSuffix(path).split('/').filter(Boolean);
        if (segments.length >= 2) {
          owner = segments[0];
          repo = segments[1];
        }
      }
    }
  } else {
    // 3) owner/repo（可能带额外路径，只取前两段）
    const segments = stripGitSuffix(trimmed).split('/').filter(Boolean);
    if (segments.length >= 2) {
      owner = segments[0];
      repo = segments[1];
    }
  }

  owner = owner.trim();
  repo = repo.trim();
  if (!owner || !repo) {
    throw new ValidationError('Invalid GitHub repository', {
      repo: '格式应为 owner/repo，例如 facebook/react',
    });
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    htmlUrl: `https://github.com/${owner}/${repo}`,
  };
}

function stripGitSuffix(value: string): string {
  return value
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
}

/** 生成 Release 去重键：`github:release:{id}`。 */
export function buildReleaseDedupeKey(releaseId: string | number): string {
  return `github:release:${releaseId}`;
}

/** Release 标题：优先 `name`，其次 `tag_name`，兜底 `Release {tag}`。 */
export function buildReleaseTitle(release: GithubRelease): string {
  const name = release.name?.trim();
  if (name) return name;
  const tag = release.tagName?.trim();
  if (tag) return tag;
  return `Release ${release.tagName ?? release.id}`;
}

export interface GithubReleaseDraft {
  ghId: string;
  ghType: 'release';
  dedupeKey: string;
  title: string;
  tagName: string | null;
  author: string | null;
  publishedAt: string;
  contentHtml: string;
  bodyMarkdown: string | null;
  htmlUrl: string;
  isPrerelease: boolean;
  isDraft: boolean;
}

export interface ToReleaseDraftContext {
  /** 注入正文渲染函数，避免映射层直接依赖 githubMarkdown（便于单测）。 */
  renderBody: (input: {
    bodyMarkdown?: string | null;
    bodyHtml?: string | null;
  }) => string;
}

/**
 * 把单条 GitHub Release 投影成落库草稿。
 *
 * - `contentHtml` 由注入的 `renderBody` 计算（服务端 HTML 优先 / marked 兜底）
 * - `bodyMarkdown` 保留原始 Markdown，供未来 Goose / 重渲染使用
 * - `publishedAt` 缺失时回退到 `created_at`-ish 的当前时间，保证排序稳定
 */
export function toReleaseDraft(
  release: GithubRelease,
  ctx: ToReleaseDraftContext,
): GithubReleaseDraft {
  const contentHtml = ctx.renderBody({
    bodyHtml: release.bodyHtml,
    bodyMarkdown: release.body,
  });

  return {
    ghId: String(release.id),
    ghType: 'release',
    dedupeKey: buildReleaseDedupeKey(release.id),
    title: buildReleaseTitle(release),
    tagName: release.tagName?.trim() ?? null,
    author: release.authorLogin?.trim() ?? null,
    publishedAt: release.publishedAt ?? new Date().toISOString(),
    contentHtml,
    bodyMarkdown: release.body?.trim() ?? null,
    htmlUrl: release.htmlUrl,
    isPrerelease: release.isPrerelease,
    isDraft: release.isDraft,
  };
}
