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
