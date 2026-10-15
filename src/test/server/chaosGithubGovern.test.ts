import { describe, it, expect } from 'vitest';
import { governGithubMaterials, GITHUB_DEFAULT_MIN_STARS } from '@/server/integrations/chaos/client';

/** 中台 /open/v1/materials 素材形状的最小还原（gh = 开放接口 gh 事实字段）。 */
function material(overrides: Record<string, unknown>) {
  return {
    id: '1',
    sourceCode: 'github-api',
    title: 'owner/repo',
    url: 'https://github.com/owner/repo',
    summary: 'An English description',
    categoriesJson: ['gh-ai--llm', 'gh-ai', 'llm'],
    qualityScore: 4,
    updatedAt: '2026-10-13T07:42:09.155Z',
    gh: { stars: 5000, forks: 120, language: 'TypeScript', pushedAt: '2026-10-01T00:00:00Z', ownerAvatarUrl: 'https://avatar', categorySlug: 'gh-ai' },
    ...overrides,
  };
}

describe('governGithubMaterials（GitHub 热点治理变换）', () => {
  it('千星门槛：低于门槛与无星数事实的历史行都不入库', () => {
    const payload = {
      items: [
        material({ id: '1', title: 'a/low', gh: { stars: 999 } }),
        material({ id: '2', title: 'b/no-fact', gh: undefined }),
        material({ id: '3', title: 'c/ok', gh: { stars: 1_000 } }),
        material({ id: '4', sourceCode: 'weibo', title: 'd/not-github', gh: { stars: 9_999 } }),
      ],
    };
    const repos = governGithubMaterials(payload, GITHUB_DEFAULT_MIN_STARS);
    expect(repos.map((r) => r.repo)).toEqual(['c/ok']);
    expect(repos[0]!.stars).toBe(1_000);
  });

  it('minStars=0 关闭门槛时无星数事实的行放行（手动指定场景）', () => {
    const payload = { items: [material({ id: '1', title: 'b/no-fact', gh: undefined })] };
    const repos = governGithubMaterials(payload, 0);
    expect(repos).toHaveLength(1);
    expect(repos[0]!.stars).toBeNull();
  });

  it('分类吃中台治理 slug；展示 topics 剥掉治理命名', () => {
    const payload = { items: [material({})] };
    const repos = governGithubMaterials(payload, 1_000);
    expect(repos[0]!.category).toBe('gh-ai');
    expect(repos[0]!.categoryName).toBe('AI 与智能体');
    expect(repos[0]!.topics).toEqual(['llm']);
  });

  it('治理 slug 未登记时按标签兜底，完全不认识的落「其他」', () => {
    const unknown = governGithubMaterials({ items: [material({ categoriesJson: ['gh-future--x', 'gh-future'], gh: { stars: 2_000, categorySlug: 'gh-future' } })] });
    expect(unknown[0]!.category).toBe('misc');
    const legacy = governGithubMaterials({ items: [material({ categoriesJson: ['ios', 'shortcuts'], gh: { stars: 2_000 } })] });
    expect(legacy[0]!.category).toBe('gh-apple');
    expect(legacy[0]!.categoryName).toBe('苹果生态');
  });

  it('同仓库多 topic 身份去重，分类同级时保留更新更近的一条；结果按 stars 降序', () => {
    const payload = {
      items: [
        material({ id: '1', title: 'owner/repo', categoriesJson: ['gh-automation--workflow', 'gh-automation'], gh: { stars: 3_000, categorySlug: 'gh-automation' }, updatedAt: '2026-10-13T00:00:00Z' }),
        material({ id: '2', title: 'owner/repo', gh: { stars: 3_000, categorySlug: 'gh-ai' }, updatedAt: '2026-10-12T00:00:00Z' }),
        material({ id: '3', title: 'other/hot', gh: { stars: 9_000, categorySlug: 'gh-apple' } }),
      ],
    };
    const repos = governGithubMaterials(payload, 1_000);
    expect(repos).toHaveLength(2);
    expect(repos[0]!.repo).toBe('other/hot');
    expect(repos[1]!.repo).toBe('owner/repo');
    expect(repos[1]!.category).toBe('gh-automation');
  });
});
