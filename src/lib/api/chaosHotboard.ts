/**
 * Chaos 热榜客户端：从中台 /open/v1/materials 拉取并格式化为热榜页面所需结构。
 * 未配置/不可用时返回 null，调用方降级到本地 TrendRadar。
 */
import { apiFetch } from '@/h5/lib/auth';

export interface ChaosHotBoard {
  date: string;
  total: number;
  platforms: Array<{
    platform: string;
    platformName: string;
    items: Array<{
      id: string;
      title: string;
      url: string | null;
      rank: number | null;
      hotValue: string;
      sourceDate: string;
      contentType: string;
      platform: string;
      platformName: string;
    }>;
  }>;
}

export async function fetchChaosHotBoard(): Promise<ChaosHotBoard | null> {
  try {
    const res = await apiFetch('/s/api/chaos/hotboard');
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: ChaosHotBoard | null };
    if (!json?.ok || !json.data || !json.data.platforms?.length) return null;
    return json.data;
  } catch {
    return null;
  }
}

/** GitHub 仓库卡片（中台素材治理后结构） */
export interface ChaosGithubRepo {
  id: string;
  repo: string;
  description: string | null;
  topics: string[];
  category: string;
  categoryName: string;
  url: string | null;
  qualityScore: number | null;
  updatedAt: string | null;
}

export interface ChaosGithubCategory {
  key: string;
  name: string;
  count: number;
}

export interface ChaosGithubPage {
  items: ChaosGithubRepo[];
  total: number;
  /** 治理全量仓库数（不受 category 过滤影响），「全部」chip 用 */
  grandTotal: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  categories: ChaosGithubCategory[];
  fetchedAt?: string;
}

/** GitHub 仓库分页：category=all 走治理全量，翻页由服务端切片。 */
export async function fetchChaosGithubRepos(
  page = 1,
  category = 'all',
): Promise<ChaosGithubPage | null> {
  try {
    const res = await apiFetch(
      `/s/api/chaos/github?page=${page}&pageSize=20&category=${encodeURIComponent(category)}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: ChaosGithubPage | null };
    if (!json?.ok || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

/** DSH 插件市场卡片 */
export interface ChaosDshPlugin {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  stars: number;
  riskScore: number | null;
  installCommand: string | null;
  sourceUrl: string | null;
}

export interface ChaosDshCategory {
  slug: string;
  name: string;
  pluginCount: number;
}

export interface ChaosDshPage {
  items: ChaosDshPlugin[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchChaosDshMarket(
  page = 1,
  category = 'all',
): Promise<ChaosDshPage | null> {
  try {
    const res = await apiFetch(
      `/s/api/chaos/dsh/market?page=${page}&pageSize=20&category=${encodeURIComponent(category)}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: ChaosDshPage | null };
    if (!json?.ok || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

export async function fetchChaosDshCategories(): Promise<ChaosDshCategory[]> {
  try {
    const res = await apiFetch('/s/api/chaos/dsh/categories');
    if (!res.ok) return [];
    const json = (await res.json()) as { ok?: boolean; data?: ChaosDshCategory[] | null };
    return json?.ok ? (json.data ?? []) : [];
  } catch {
    return [];
  }
}
