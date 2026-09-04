/**
 * 前端侧 GitHub 仓库输入解析与即时校验。
 *
 * 与后端 `integrations/github/githubResourceMapper.ts` 的 `parseRepoInput` 保持同规则：
 * 支持 `owner/repo`、`https://github.com/owner/repo(.git)`、`git@github.com:owner/repo.git`
 * 以及带 `?query#hash`、大小写等写法，统一归一化为 `{ owner, repo, fullName, htmlUrl }`。
 *
 * 与后端不同，这里返回 `ParsedRepoRef | null`（不抛异常），便于输入框做即时校验。
 */

export interface ParsedRepoRef {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
}

const GITHUB_HOST_PATTERN = /^(www\.)?github\.com$/i;

function stripGitSuffix(value: string): string {
  return value
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
}

/**
 * 把用户输入归一化为 `{ owner, repo, fullName, htmlUrl }`。
 * 无法识别（空、非法 host、不足两段）时返回 `null`。
 */
export function parseRepoInput(raw: string): ParsedRepoRef | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  let owner = '';
  let repo = '';

  const sshMatch = trimmed.match(/^git@([^/:]+):(.+)$/i);
  if (sshMatch && GITHUB_HOST_PATTERN.test(sshMatch[1])) {
    const segments = stripGitSuffix(sshMatch[2]).split('/').filter(Boolean);
    if (segments.length >= 2) {
      owner = segments[0];
      repo = segments[1];
    }
  } else if (/^https?:\/\//i.test(trimmed) || trimmed.includes('github.com')) {
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
    const segments = stripGitSuffix(trimmed).split('/').filter(Boolean);
    if (segments.length >= 2) {
      owner = segments[0];
      repo = segments[1];
    }
  }

  owner = owner.trim();
  repo = repo.trim();
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    htmlUrl: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * 即时校验仓库输入，返回错误文案；合法时返回 `null`。
 * 仅做格式层面的轻量校验，最终以服务端校验为准（服务端还会探测仓库是否存在）。
 */
export function validateRepoInput(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return '请输入仓库地址，例如 facebook/react';
  }

  const parsed = parseRepoInput(trimmed);
  if (!parsed) {
    return '格式应为 owner/repo，或粘贴完整的 GitHub 仓库链接';
  }

  return null;
}
