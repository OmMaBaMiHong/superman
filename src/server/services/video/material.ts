import { getPool } from '@/server/infra/db/pool';

export interface VideoMaterial {
  id: number;
  articleId: number;
  userId: number;
  videoUrl: string;
  videoTitle: string;
  provider: string;
  transcriptText: string | null;
  transcriptSource: 'subtitle' | 'whisper' | null;
  transcriptLanguage: string | null;
  transcriptExtractedAt: string | null;
  videoFilePath: string | null;
  videoFileName: string | null;
  videoFileSize: number | null;
  videoDownloadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTranscriptParams {
  articleId: number;
  userId: number;
  videoUrl: string;
  videoTitle: string;
  provider: string;
  text: string;
  source: 'subtitle' | 'whisper';
  language?: string;
}

export interface SaveDownloadParams {
  articleId: number;
  userId: number;
  videoUrl: string;
  videoTitle: string;
  provider: string;
  filePath: string;
  fileName: string;
  fileSize: number;
}

/** 查询某篇文章的视频素材 */
export async function getVideoMaterial(
  articleId: number,
  userId: number,
): Promise<VideoMaterial | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
      id, article_id, user_id, video_url, video_title, provider,
      transcript_text, transcript_source, transcript_language, transcript_extracted_at,
      video_file_path, video_file_name, video_file_size, video_downloaded_at,
      created_at, updated_at
    from video_materials
    where article_id = $1 and user_id = $2`,
    [articleId, userId],
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    articleId: r.article_id,
    userId: r.user_id,
    videoUrl: r.video_url,
    videoTitle: r.video_title,
    provider: r.provider,
    transcriptText: r.transcript_text,
    transcriptSource: r.transcript_source,
    transcriptLanguage: r.transcript_language,
    transcriptExtractedAt: r.transcript_extracted_at,
    videoFilePath: r.video_file_path,
    videoFileName: r.video_file_name,
    videoFileSize: r.video_file_size,
    videoDownloadedAt: r.video_downloaded_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 保存文案到视频素材 */
export async function saveTranscript(params: SaveTranscriptParams): Promise<void> {
  const pool = getPool();
  await pool.query(
    `insert into video_materials (article_id, user_id, video_url, video_title, provider, transcript_text, transcript_source, transcript_language, transcript_extracted_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, now())
    on conflict (article_id, user_id)
    do update set
      transcript_text = excluded.transcript_text,
      transcript_source = excluded.transcript_source,
      transcript_language = excluded.transcript_language,
      transcript_extracted_at = excluded.transcript_extracted_at,
      updated_at = now()`,
    [
      params.articleId,
      params.userId,
      params.videoUrl,
      params.videoTitle,
      params.provider,
      params.text,
      params.source,
      params.language ?? null,
    ],
  );
}

/** 保存下载信息到视频素材 */
export async function saveDownload(params: SaveDownloadParams): Promise<void> {
  const pool = getPool();
  await pool.query(
    `insert into video_materials (article_id, user_id, video_url, video_title, provider, video_file_path, video_file_name, video_file_size, video_downloaded_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, now())
    on conflict (article_id, user_id)
    do update set
      video_file_path = excluded.video_file_path,
      video_file_name = excluded.video_file_name,
      video_file_size = excluded.video_file_size,
      video_downloaded_at = excluded.video_downloaded_at,
      updated_at = now()`,
    [
      params.articleId,
      params.userId,
      params.videoUrl,
      params.videoTitle,
      params.provider,
      params.filePath,
      params.fileName,
      params.fileSize,
    ],
  );
}