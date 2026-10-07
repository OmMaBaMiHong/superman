'use client';

import { Bookmark, Check, Image as ImageIcon, Lightbulb, Link, Loader2, Sparkles, Text, Upload, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFeed, createProductPlan, generateProductPlanFromArticle } from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { apiFetch } from '../lib/auth';

type InputMode = 'text' | 'image' | 'video' | 'smart';
type CaptureTarget = 'clip' | 'product';

interface SmartResult {
  articleId: number | string;
  title: string;
  kind: string;
  cover?: string | null;
  transcriptPending?: boolean;
  alreadyExists?: boolean;
  creator?: { rssHubUrl: string; nickname: string | null; secUid: string | null } | null;
}

interface PastePanelProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (articleId: number | string) => void;
}

export default function PastePanel({ open, onClose, onSaved }: PastePanelProps) {
  const [target, setTarget] = useState<CaptureTarget>('clip');
  const [mode, setMode] = useState<InputMode>('smart');
  const [content, setContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [smartText, setSmartText] = useState('');
  const [ideaText, setIdeaText] = useState('');
  const [ideaNote, setIdeaNote] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [following, setFollowing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [smartResult, setSmartResult] = useState<SmartResult | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setTarget('clip');
    setContent('');
    setSourceUrl('');
    setSmartText('');
    setIdeaText('');
    setIdeaNote('');
    setImages([]);
    setVideo(null);
    setMode('smart');
    setSmartResult(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const pasteFromClipboard = useCallback(async (target: 'content' | 'smart') => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (target === 'smart') setSmartText(text);
        else setContent((prev) => (prev ? `${prev}\n${text}` : text));
        toast.success('已粘贴剪贴板内容');
      }
    } catch {
      toast.info('无法读取剪贴板，请手动粘贴');
    }
  }, []);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setImages((prev) => [...prev, ...files]);
      toast.success(`已添加 ${files.length} 张图片`);
    }
  }, []);

  /** 从 DataTransfer / ClipboardEvent 中取出图片文件。 */
  const pickImageFiles = useCallback((data: DataTransfer | null): File[] => {
    if (!data) return [];
    const out: File[] = [];
    // 1) items（截图粘贴走这里）
    if (data.items && data.items.length) {
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) out.push(f);
        }
      }
    }
    // 2) files 兜底（拖拽/部分浏览器）
    if (out.length === 0 && data.files && data.files.length) {
      for (const f of Array.from(data.files)) {
        if (f.type.startsWith('image/')) out.push(f);
      }
    }
    return out;
  }, []);

  // 截图粘贴：Cmd/Ctrl+V 直接贴图片（全局监听，面板打开时生效）
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = pickImageFiles(e.clipboardData);
      if (files.length === 0) return; // 纯文本粘贴不拦截
      e.preventDefault();
      setImages((prev) => [...prev, ...files]);
      setMode('image');
      toast.success(`已粘贴 ${files.length} 张图片`);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, pickImageFiles]);

  const handleVideoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setVideo(file); toast.success(`已添加视频: ${file.name}`); }
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFollow = useCallback(async () => {
    const creator = smartResult?.creator;
    if (!creator) return;
    setFollowing(true);
    try {
      await createFeed({
        title: creator.nickname ? `抖音 · ${creator.nickname}` : '抖音博主',
        url: creator.rssHubUrl,
        siteUrl: creator.secUid ? `https://www.douyin.com/user/${creator.secUid}` : null,
      });
      toast.success(`已关注「${creator.nickname || '博主'}」`);
      setSmartResult((prev) => (prev ? { ...prev, creator: null } : prev));
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setFollowing(false);
    }
  }, [smartResult]);

  /** 把已收藏的作品一键转成产品计划（基于 article，天然关联 + 幂等去重）。 */
  const handleConvertToProductPlan = useCallback(async () => {
    const articleId = smartResult?.articleId;
    if (!articleId) return;
    setConverting(true);
    try {
      const result = await generateProductPlanFromArticle(String(articleId));
      toast.success(result.alreadyExists ? '该内容已有产品计划' : `已生成产品计划：${result.plan.title}`);
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setConverting(false);
    }
  }, [smartResult]);

  /** 纯想法 → 产品计划；文本里含已收录链接时，后端自动挂到对应文章（真相源唯一）。 */
  const handleCreateIdeaPlan = useCallback(async () => {
    const rawIdea = ideaText.trim();
    if (!rawIdea) { toast.info('请输入产品想法'); return; }
    setSaving(true);
    try {
      const result = await createProductPlan({ rawIdea, note: ideaNote.trim() || null });
      toast.success(
        result.alreadyExists
          ? '该内容已有产品计划'
          : result.usedFallback
            ? '已记录（AI 未配置，先占位）'
            : `已生成产品计划：${result.plan.title}`,
      );
      reset();
      onClose();
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setSaving(false);
    }
  }, [ideaText, ideaNote, reset, onClose]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (mode === 'text') {
        if (!content.trim()) { toast.info('请输入内容'); setSaving(false); return; }
        const res = await apiFetch('/s/api/clips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentText: content.trim(), sourceUrl: sourceUrl.trim() || undefined }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error?.message || '保存失败');
        toast.success(data.data?.alreadyExists ? '已在收藏中（复用已有记录）' : '已收入收藏夹');
        onSaved?.(data.data?.articleId);
        reset();
      } else if (mode === 'smart') {
        if (!smartText.trim()) { toast.info('请粘贴内容或链接'); setSaving(false); return; }
        const res = await apiFetch('/s/api/clipboard/smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: smartText.trim() }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error?.message || '识别失败');
        setSmartResult(data.data as SmartResult);
        toast.success(
          data.data?.kind === 'creator'
            ? '已识别博主'
            : data.data?.alreadyExists
              ? '已在收藏中（复用已有记录）'
              : '已收藏',
        );
        if (data.data?.articleId) onSaved?.(data.data.articleId);
      } else if (mode === 'image') {
        if (images.length === 0) { toast.info('请选择图片'); setSaving(false); return; }
        const formData = new FormData();
        images.forEach((f) => formData.append('images', f));
        if (sourceUrl) formData.append('sourceUrl', sourceUrl);
        const res = await apiFetch('/s/api/clipboard/image', { method: 'POST', body: formData });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error?.message || '上传失败');
        toast.success('图片已收藏');
        onSaved?.(data.data?.articleId);
        reset();
      } else if (mode === 'video') {
        if (!video) { toast.info('请选择视频'); setSaving(false); return; }
        const formData = new FormData();
        formData.append('video', video);
        if (sourceUrl) formData.append('sourceUrl', sourceUrl);
        const res = await apiFetch('/s/api/clipboard/video', { method: 'POST', body: formData });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error?.message || '上传失败');
        toast.success('视频已收藏');
        onSaved?.(data.data?.articleId);
        reset();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [mode, content, sourceUrl, smartText, images, video, onSaved, reset]);

  if (!open) return null;

  const modes: Array<{ key: InputMode; label: string; Icon: typeof Text }> = [
    { key: 'smart', label: '智能', Icon: Sparkles },
    { key: 'text', label: '文本', Icon: Text },
    { key: 'image', label: '图片', Icon: ImageIcon },
    { key: 'video', label: '视频', Icon: Upload },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={handleClose}>
      <div className="w-full max-w-xl rounded-t-3xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 顶部把手 + 关闭 */}
        <div className="flex items-center justify-between px-5 pt-3 pb-1">
          <div className="mx-auto h-1 w-10 rounded-full bg-muted" />
          <button type="button" aria-label="关闭" onClick={handleClose}
            className="absolute right-4 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 标题 */}
        <div className="px-5 pb-3">
          <h2 className="text-base font-semibold">{target === 'clip' ? '📌 添加收藏' : '💡 记录产品想法'}</h2>
          <p className="text-xs text-muted-foreground">
            {target === 'clip'
              ? '粘贴分享文字/链接、上传图片视频，直接归档到选题库'
              : '把点子整理成产品 MVP 规划；文本含已收藏链接会自动关联，不产生重复'}
          </p>
        </div>

        {/* 目标切换：收藏 / 产品计划 */}
        <div className="mx-5 mb-3 flex gap-1 rounded-full bg-muted/50 p-1">
          {([['clip', '收藏', Bookmark], ['product', '产品计划', Lightbulb]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTarget(key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-xs font-medium transition-all',
                target === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* 模式切换（仅收藏目标） */}
        {target === 'clip' && (
          <div className="flex gap-1 px-5">
            {modes.map((m) => (
              <button key={m.key} type="button" onClick={() => setMode(m.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-xs font-medium transition-all',
                  mode === m.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <m.Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* 内容区 */}
        <div className="px-5 py-4">
          {/* 产品目标：纯想法输入 */}
          {target === 'product' && (
            <div className="space-y-2">
              <textarea value={ideaText} onChange={(e) => setIdeaText(e.target.value)}
                placeholder={'把你的产品想法写下来，例如：\n做一个帮自媒体人一键把长文转口播稿的工具，面向个人博主…'}
                rows={6} autoFocus
                className="w-full resize-none rounded-xl border border-border px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none"
              />
              <input type="text" value={ideaNote} onChange={(e) => setIdeaNote(e.target.value)}
                placeholder="补充备注 / 约束（可选）：人群、预算、已有资源…"
                className="h-10 w-full rounded-xl border border-border px-3 text-xs placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none"
              />
              <p className="text-[11px] text-muted-foreground">
                若想法里含已收藏的链接，会自动关联到那条收藏，不重复入库。
              </p>
            </div>
          )}

          {/* 收藏目标：智能/文本/图片/视频 */}
          {target === 'clip' && (
          <>
          {/* 智能模式：粘贴分享文字，自动提取链接 */}
          {mode === 'smart' && (
            <div className="space-y-2">
              <textarea value={smartText} onChange={(e) => { setSmartText(e.target.value); setSmartResult(null); }}
                placeholder={'直接粘贴分享内容即可，例如：\n「这个博主… https://v.douyin.com/xxx/ 复制此链接，打开抖音搜索…」'}
                rows={4} autoFocus
                className="w-full resize-none rounded-xl border border-border px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => pasteFromClipboard('smart')}
                  className="text-[11px] text-primary hover:underline">从剪贴板粘贴</button>
                <p className="text-[11px] text-muted-foreground">自动提取链接 · 识别博主 · 收藏作品</p>
              </div>

              {/* 收藏结果 + 关注博主 + 一键转产品计划 */}
              {smartResult && (
                <div className="rounded-xl border border-success/30 bg-success/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" />
                    {smartResult.kind === 'creator'
                      ? '已识别博主'
                      : smartResult.alreadyExists
                        ? '已在收藏中（复用已有记录）'
                        : '已收藏'}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-foreground">{smartResult.title}</p>
                  {smartResult.transcriptPending && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      🎬 正在后台下载视频并提取文案（约 30-60 秒），完成后可在「创作台 → 选题池」直接二创
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {smartResult.creator && (
                      <button type="button" onClick={handleFollow} disabled={following}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {following ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                        关注博主{smartResult.creator.nickname ? ` @${smartResult.creator.nickname}` : ''}
                      </button>
                    )}
                    {smartResult.kind !== 'creator' && smartResult.articleId ? (
                      <button type="button" onClick={handleConvertToProductPlan} disabled={converting}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary disabled:opacity-50"
                      >
                        {converting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                        生成产品计划
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === 'text' && (
            <div className="space-y-2">
              <textarea value={content} onChange={(e) => setContent(e.target.value)}
                placeholder="粘贴文本内容..."
                rows={5} autoFocus
                className="w-full resize-none rounded-xl border border-border px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none"
              />
              <button type="button" onClick={() => pasteFromClipboard('content')}
                className="text-[11px] text-primary hover:underline">从剪贴板粘贴</button>
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="来源链接（可选）"
                  className="flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                />
              </div>
            </div>
          )}

          {mode === 'image' && (
            <div className="space-y-3">
              <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
              <button type="button" onClick={() => imageInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = pickImageFiles(e.dataTransfer);
                  if (files.length) { setImages((prev) => [...prev, ...files]); toast.success(`已添加 ${files.length} 张图片`); }
                }}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-8 text-muted-foreground hover:border-primary hover:text-primary"
              >
                <ImageIcon className="h-6 w-6" />
                <span className="text-xs">点击选择 / 拖拽图片到此处</span>
                <span className="text-[11px] text-primary">截图后直接 ⌘/Ctrl+V 粘贴</span>
              </button>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((f, i) => (
                    <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                      <button type="button" onClick={() => removeImage(i)}
                        className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl bg-black/60 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="来源链接（可选）"
                  className="flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                />
              </div>
            </div>
          )}

          {mode === 'video' && (
            <div className="space-y-3">
              <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} />
              <button type="button" onClick={() => videoInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-8 text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Upload className="h-6 w-6" />
                <span className="text-xs">{video ? video.name : '点击选择视频文件'}</span>
              </button>
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="来源链接（可选）"
                  className="flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                />
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-2 px-5 pb-6">
          <button type="button" onClick={handleClose}
            className="flex-1 rounded-full border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            {smartResult ? '完成' : '取消'}
          </button>
          <button type="button" onClick={target === 'product' ? handleCreateIdeaPlan : handleSave} disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary py-2.5 text-sm font-medium text-primary-foreground shadow-md shadow-primary/20 transition-opacity disabled:opacity-50 hover:opacity-90"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {target === 'product' ? '💡 生成产品计划' : mode === 'smart' ? '✨ 智能收藏' : '⭐ 收藏'}
          </button>
        </div>
      </div>
    </div>
  );
}
