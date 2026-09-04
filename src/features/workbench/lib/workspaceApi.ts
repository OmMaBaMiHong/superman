/**
 * 工作台 · 工作区 —— 前端 API 封装。
 *
 * 素材上传 / 列表 / 删除 / 文案提取均走 FeedFuse 本地 `/api/workspace/*`，
 * 响应统一为 `{ ok: true, data }` / `{ ok: false, error }` 信封。
 */

export type WorkspaceMaterialKind = 'video' | 'file';

export interface WorkspaceMaterial {
  id: number;
  userId: number;
  kind: WorkspaceMaterialKind;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
  transcriptText: string | null;
  transcriptSource: 'subtitle' | 'whisper' | null;
  transcriptLanguage: string | null;
  transcriptExtractedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTranscriptResult {
  text: string;
  source: 'subtitle' | 'whisper';
  language?: string;
}

async function readOk<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => null)) as {
    ok: boolean;
    data?: T;
    error?: { message?: string };
  } | null;
  if (!payload || !payload.ok) {
    throw new Error(payload?.error?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return payload.data as T;
}

/** 列出当前用户的全部工作区素材（新的在前） */
export async function listWorkspaceMaterials(): Promise<WorkspaceMaterial[]> {
  const res = await fetch('/api/workspace/materials', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readOk<WorkspaceMaterial[]>(res);
}

/** 上传素材（视频或文件），返回创建的素材记录 */
export async function uploadWorkspaceMaterial(
  file: File,
  title?: string,
): Promise<WorkspaceMaterial> {
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);
  const res = await fetch('/api/workspace/upload', {
    method: 'POST',
    body: form,
  });
  return readOk<WorkspaceMaterial>(res);
}

/** 删除素材（同时清理磁盘文件） */
export async function deleteWorkspaceMaterial(id: number): Promise<void> {
  const res = await fetch(`/api/workspace/materials/${id}`, {
    method: 'DELETE',
  });
  await readOk<{ id: number }>(res);
}

/**
 * 通过 URL 解析并下载视频到工作区。
 * 支持任意 yt-dlp 可解析的视频链接（B站 / 抖音 / 小红书 / YouTube 等），不限于 RSSHub。
 */
export async function downloadWorkspaceUrl(url: string): Promise<WorkspaceMaterial> {
  const res = await fetch('/api/workspace/download-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return readOk<WorkspaceMaterial>(res);
}

/** 视频文案提取（Whisper 本地语音识别） */
export async function extractWorkspaceTranscript(id: number): Promise<WorkspaceTranscriptResult> {
  const res = await fetch(`/api/workspace/transcript/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  return readOk<WorkspaceTranscriptResult>(res);
}

/** 视频文件播放 / 下载地址（供 OpenChatCut 去剪辑导入） */
export function workspaceVideoServeUrl(id: number): string {
  return `/api/workspace/serve/${id}`;
}
