import { z } from 'zod';

/**
 * GitHub REST 响应 zod 校验。
 *
 * 防御性收口：GitHub 在不同状态码下返回的字段并不稳定（例如 draft release 缺
 * `published_at`、部分字段为 null），所有可选字段统一 `null`-化，调用方不必再判空。
 */

export const githubRepositorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    private: z.boolean().optional().default(false),
    html_url: z.string(),
    description: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    stargazers_count: z.number().nullable().optional(),
    avatar_url: z.string().nullable().optional(),
    owner: z.object({
      login: z.string(),
      avatar_url: z.string().nullable().optional(),
    }),
  })
  .transform((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    isPrivate: repo.private,
    htmlUrl: repo.html_url,
    description: repo.description ?? null,
    language: repo.language ?? null,
    stargazers: repo.stargazers_count ?? null,
    avatarUrl: repo.avatar_url ?? null,
    ownerLogin: repo.owner.login,
  }));

export type GithubRepository = z.infer<typeof githubRepositorySchema>;

export const githubReleaseSchema = z
  .object({
    id: z.number(),
    tag_name: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    body_html: z.string().nullable().optional(),
    html_url: z.string(),
    prerelease: z.boolean().optional().default(false),
    draft: z.boolean().optional().default(false),
    published_at: z.string().nullable().optional(),
    target_commitish: z.string().nullable().optional(),
    author: z.object({ login: z.string() }).nullable().optional(),
  })
  .transform((release) => ({
    id: release.id,
    tagName: release.tag_name ?? null,
    name: release.name ?? null,
    body: release.body ?? null,
    bodyHtml: release.body_html ?? null,
    htmlUrl: release.html_url,
    isPrerelease: release.prerelease,
    isDraft: release.draft,
    publishedAt: release.published_at ?? null,
    authorLogin: release.author?.login ?? null,
  }));

export type GithubRelease = z.infer<typeof githubReleaseSchema>;
