-- ============================================================
-- 0063_video_transcript_status.sql —— 视频文案提取状态
--
-- 背景：收藏视频后会后台提取文案（yt-dlp 字幕 / Whisper 语音识别）。
--   前端需要一个状态来展示「提取中 / 已完成 / 失败」并支持重试。
--
-- video_materials 加列：
--   transcript_status：none | extracting | done | failed
--   transcript_error：失败原因（供重试提示）
--
-- 迁移安全性：全部 if not exists / drop if exists，幂等。
-- ============================================================

alter table video_materials
  add column if not exists transcript_status text not null default 'none',
  add column if not exists transcript_error text;

alter table video_materials drop constraint if exists video_materials_transcript_status_check;
alter table video_materials
  add constraint video_materials_transcript_status_check
  check (transcript_status in ('none', 'extracting', 'done', 'failed'));

-- 已有文案的旧数据回填为 done
update video_materials
  set transcript_status = 'done'
  where transcript_text is not null and transcript_status = 'none';
