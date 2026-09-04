'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  FileText,
  Link2,
  Loader2,
  Play,
  Scissors,
  Trash2,
  UploadCloud,
  Video as VideoIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/features/toast/toast';
import {
  deleteWorkspaceMaterial,
  downloadWorkspaceUrl,
  extractWorkspaceTranscript,
  listWorkspaceMaterials,
  uploadWorkspaceMaterial,
  type WorkspaceMaterial,
} from '../lib/workspaceApi';

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WorkspaceSection() {
  const [materials, setMaterials] = useState<WorkspaceMaterial[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [urlInput, setUrlInput] = useState('');
  const [downloadingUrl, setDownloadingUrl] = useState(false);

  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // 展开的素材（文案 / 播放器）
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listWorkspaceMaterials();
      setMaterials(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载素材失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFileChange = useCallback((file: File | undefined) => {
    setSelectedFile(file ?? null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      toast.error('请先选择要上传的素材文件');
      return;
    }
    setUploading(true);
    try {
      const material = await uploadWorkspaceMaterial(selectedFile);
      setMaterials((prev) => [material, ...prev]);
      setSelectedFile(null);
      toast.success(
        material.kind === 'video' ? '视频素材已上传' : '文件素材已上传',
        { dedupeKey: 'workspace-uploaded' },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, [selectedFile]);

  const handleDownloadUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) {
      toast.error('请先粘贴要解析的视频链接');
      return;
    }
    setDownloadingUrl(true);
    try {
      const material = await downloadWorkspaceUrl(url);
      setMaterials((prev) => [material, ...prev]);
      setUrlInput('');
      toast.success('视频已下载到工作区', { dedupeKey: 'workspace-url-downloaded' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'URL 解析下载失败', {
        dedupeKey: 'workspace-url-download-failed',
      });
    } finally {
      setDownloadingUrl(false);
    }
  }, [urlInput]);

  const handleExtract = useCallback(
    async (material: WorkspaceMaterial) => {
      if (extractingId !== null) return;
      setExtractingId(material.id);
      try {
        const result = await extractWorkspaceTranscript(material.id);
        setMaterials((prev) =>
          prev.map((item) =>
            item.id === material.id
              ? {
                  ...item,
                  transcriptText: result.text,
                  transcriptSource: result.source,
                  transcriptLanguage: result.language ?? null,
                  transcriptExtractedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        setExpandedId(material.id);
        toast.success('文案提取完成', { dedupeKey: 'workspace-transcript-done' });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '文案提取失败', {
          dedupeKey: 'workspace-transcript-failed',
        });
      } finally {
        setExtractingId(null);
      }
    },
    [extractingId],
  );

  const handleDelete = useCallback(
    async (material: WorkspaceMaterial) => {
      if (deletingId !== null) return;
      setDeletingId(material.id);
      try {
        await deleteWorkspaceMaterial(material.id);
        setMaterials((prev) => prev.filter((item) => item.id !== material.id));
        toast.success('素材已删除');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '删除失败');
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  return (
    <section className="flex flex-col gap-6" data-testid="workspace-section">
      {/* URL 解析下载区 */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">链接解析下载</h2>
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Link2 className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              type="url"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleDownloadUrl();
              }}
              placeholder="粘贴视频链接，如 B站 / 抖音 / 小红书 / YouTube…"
              className="h-9 w-full rounded-xl border border-border/80 bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />
          </div>
          <Button onClick={handleDownloadUrl} disabled={!urlInput.trim() || downloadingUrl}>
            {downloadingUrl ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                解析中…
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4" />
                解析下载
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          粘贴任意视频链接即可下载成素材，无需先添加订阅；下载后支持「文案提取」与「去剪辑」。
        </p>
      </div>

      {/* 上传区 */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">素材上传</h2>
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 px-4 py-8 text-center transition-colors hover:border-primary/40',
            selectedFile &&
              'border-solid border-primary/40 bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)]',
          )}
        >
          <UploadCloud className="h-8 w-8 text-primary/70" />
          {selectedFile ? (
            <>
              <p className="max-w-full truncate text-sm font-medium text-foreground">
                {selectedFile.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-foreground">点击选择视频或文章 / 文件素材</p>
              <p className="text-xs text-muted-foreground">
                支持 MP4 等常见视频格式，也可上传文档、文本等文件，可重新选择覆盖
              </p>
            </>
          )}
          <input
            type="file"
            accept="video/*,audio/*,.pdf,.doc,.docx,.txt,.md,.html,.markdown,.xls,.xlsx,.ppt,.pptx"
            className="hidden"
            onChange={(event) => handleFileChange(event.target.files?.[0])}
          />
        </label>

        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                上传中…
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" />
                上传到工作区
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          视频上传后支持「文案提取」与「去剪辑」；后续素材将自动进入知识库（RAG）。
        </p>
      </div>

      {/* 素材列表 */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">我的素材</h2>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载素材中…
          </div>
        ) : materials.length === 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border/80 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              工作区还没有素材，上传第一个视频或文件开始创作。
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/80">
            {materials.map((material) => {
              const expanded = expandedId === material.id;
              const isVideo = material.kind === 'video';
              const extracting = extractingId === material.id;
              const deleting = deletingId === material.id;

              return (
                <li
                  key={material.id}
                  className="flex flex-col gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/40 text-primary/80">
                        {isVideo ? (
                          <VideoIcon className="h-4 w-4" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {material.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {isVideo ? '视频' : '文件'} · {formatSize(material.fileSize)} ·{' '}
                          {formatDate(material.createdAt)}
                        </p>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isVideo && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExtract(material)}
                            disabled={extracting}
                          >
                            {extracting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}
                            {extracting
                              ? '提取中…'
                              : material.transcriptText
                                ? '查看文案'
                                : '文案提取'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-amber-600 hover:bg-amber-500/10 hover:text-amber-500 dark:text-amber-400"
                            title="使用 OpenChatCut 剪辑视频"
                            onClick={() => {
                              window.open(
                                `http://localhost:5199/#/import-ws/${material.id}`,
                                '_blank',
                              );
                            }}
                          >
                            <Scissors className="h-3.5 w-3.5" />
                            去剪辑
                          </Button>
                        </>
                      )}
                      {isVideo && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(expanded ? null : material.id)}
                        >
                          <Play className="h-3.5 w-3.5" />
                          播放
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="删除素材"
                        onClick={() => handleDelete(material)}
                        disabled={deleting}
                      >
                        {deleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* 视频播放器（点击播放展开） */}
                  {isVideo && expanded && (
                    <div className="overflow-hidden rounded-xl border border-border/70 bg-black">
                      <video
                        src={`/api/workspace/serve/${material.id}`}
                        controls
                        className="aspect-video w-full"
                        preload="metadata"
                      />
                    </div>
                  )}

                  {/* 文案展示（内联可折叠） */}
                  {material.transcriptText && (
                    <div className="overflow-hidden rounded-xl border border-border/70">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : material.id)}
                        className="flex w-full items-center justify-between bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <span>
                          视频文案
                          {material.transcriptSource === 'whisper' && (
                            <span className="ml-2 opacity-60">(语音识别)</span>
                          )}
                          {material.transcriptSource === 'subtitle' && (
                            <span className="ml-2 opacity-60">(字幕)</span>
                          )}
                        </span>
                        <ChevronDown
                          className={cn(
                            'h-3.5 w-3.5 transition-transform duration-200',
                            expanded && 'rotate-180',
                          )}
                        />
                      </button>
                      {expanded && (
                        <div className="max-h-72 overflow-y-auto border-t border-border/60 px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                            {material.transcriptText}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
