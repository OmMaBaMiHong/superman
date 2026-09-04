import { getPool } from '@/server/infra/db/pool';

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

export interface CreateWorkspaceMaterialParams {
  userId: number;
  kind: WorkspaceMaterialKind;
  title: string;
  fileName: string;
  filePath: string;
  fileSize?: number | null;
  mimeType?: string | null;
}

export interface SaveWorkspaceTranscriptParams {
  id: number;
  userId: number;
  text: string;
  source: 'subtitle' | 'whisper';
  language?: string | null;
}

function mapRow(r: Record<string, unknown>): WorkspaceMaterial {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    kind: r.kind as WorkspaceMaterialKind,
    title: r.title as string,
    fileName: r.file_name as string,
    filePath: r.file_path as string,
    fileSize: r.file_size == null ? null : Number(r.file_size),
    mimeType: r.mime_type as string | null,
    transcriptText: r.transcript_text as string | null,
    transcriptSource: r.transcript_source as 'subtitle' | 'whisper' | null,
    transcriptLanguage: r.transcript_language as string | null,
    transcriptExtractedAt: r.transcript_extracted_at as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** 列出当前用户的工作区素材（新的在前） */
export async function listWorkspaceMaterials(userId: number): Promise<WorkspaceMaterial[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
      id, user_id, kind, title, file_name, file_path, file_size, mime_type,
      transcript_text, transcript_source, transcript_language, transcript_extracted_at,
      created_at, updated_at
     from workspace_materials
     where user_id = $1
     order by created_at desc`,
    [userId],
  );
  return rows.map(mapRow);
}

/** 查询单个工作区素材 */
export async function getWorkspaceMaterial(
  id: number,
  userId: number,
): Promise<WorkspaceMaterial | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
      id, user_id, kind, title, file_name, file_path, file_size, mime_type,
      transcript_text, transcript_source, transcript_language, transcript_extracted_at,
      created_at, updated_at
     from workspace_materials
     where id = $1 and user_id = $2
     limit 1`,
    [id, userId],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/** 创建工作区素材 */
export async function createWorkspaceMaterial(
  params: CreateWorkspaceMaterialParams,
): Promise<WorkspaceMaterial> {
  const pool = getPool();
  const { rows } = await pool.query(
    `insert into workspace_materials
      (user_id, kind, title, file_name, file_path, file_size, mime_type)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning
      id, user_id, kind, title, file_name, file_path, file_size, mime_type,
      transcript_text, transcript_source, transcript_language, transcript_extracted_at,
      created_at, updated_at`,
    [
      params.userId,
      params.kind,
      params.title,
      params.fileName,
      params.filePath,
      params.fileSize ?? null,
      params.mimeType ?? null,
    ],
  );
  return mapRow(rows[0]);
}

/** 保存文案到工作区素材 */
export async function saveWorkspaceTranscript(
  params: SaveWorkspaceTranscriptParams,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `update workspace_materials
     set transcript_text = $1, transcript_source = $2, transcript_language = $3,
         transcript_extracted_at = now(), updated_at = now()
     where id = $4 and user_id = $5`,
    [params.text, params.source, params.language ?? null, params.id, params.userId],
  );
}

/** 删除工作区素材（数据库记录；文件删除由调用方负责） */
export async function deleteWorkspaceMaterial(id: number, userId: number): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `delete from workspace_materials
     where id = $1 and user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}
