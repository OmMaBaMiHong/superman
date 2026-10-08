/**
 * H5 侧 WaveForge 客户端：「生成同款视频」走 /s/api/waveforge/*（session 鉴权由 apiFetch 统一带）。
 */
import { apiFetch } from './auth';

export interface RemakePhoto {
  /** 文件名需携带槽位关键字（招牌/门脸/店内环境/菜品/价格/地址） */
  name: string;
  base64: string;
}

export async function createRemakeJob(payload: {
  templateId: string;
  storeName: string;
  note?: string;
  session: string;
  photos: RemakePhoto[];
  sourceText?: string;
  benchmarkUrl?: string;
}): Promise<{ id: string }> {
  const res = await apiFetch('/s/api/waveforge/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ error: '响应解析失败' }));
  if (!res.ok || !data.ok) throw new Error(String(data.error ?? `创建失败 ${res.status}`));
  return { id: String(data.id) };
}

export interface RemakeJob {
  id: string;
  status: string;
  steps: Array<{ step: string; startedAt: string; finishedAt?: string; error?: string }>;
  title?: string;
  error?: string;
  renderSeconds?: number;
}

export async function fetchRemakeJob(id: string): Promise<RemakeJob | null> {
  const res = await apiFetch(`/s/api/waveforge/job/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `查询失败 ${res.status}`));
  return data as RemakeJob;
}

/**
 * 分镜预览：preview 页是 storyboard.html + 相对引用的相片，直接 iframe 会因鉴权头
 * 缺失 401。这里把页面与 6 张相片都取成 blob，重写引用后生成可离线展示的 blob URL。
 */
export async function loadRemakePreview(id: string): Promise<string> {
  const pageRes = await apiFetch(`/s/api/waveforge/job/${encodeURIComponent(id)}/preview/storyboard.html`);
  if (!pageRes.ok) throw new Error('分镜还没有就绪');
  let html = await pageRes.text();
  const photoPattern = /src="(photos\/[^"]+)"/g;
  const refs = Array.from(new Set(Array.from(html.matchAll(photoPattern), (m) => m[1]!)));
  const blobMap = new Map<string, string>();
  for (const ref of refs) {
    const res = await apiFetch(`/s/api/waveforge/job/${encodeURIComponent(id)}/preview/${ref}`);
    if (!res.ok) continue;
    blobMap.set(ref, URL.createObjectURL(await res.blob()));
  }
  html = html.replace(photoPattern, (_m, ref: string) => `src="${blobMap.get(ref) ?? ''}"`);
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
}
