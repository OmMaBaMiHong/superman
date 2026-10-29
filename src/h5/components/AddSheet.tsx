'use client';

import {
  Bookmark, Check, ChevronDown, Image as ImageIcon, Lightbulb, Link, Loader2,
  PencilLine, Plus, Sparkles, Upload, UserPlus, X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createFeed, createProductPlan, generateProductPlanFromArticle,
  listFeedItems, listRecommendedFeeds,
  listSubscribeCatalog, listSubscribePrefs, saveSubscribePrefs,
  type FeedListItem, type RecommendedFeedEntry,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { extractFirstUrl } from '@/lib/url/extractUrl';
import { apiFetch } from '../lib/auth';
import SmartUrlSubscribe from './SmartUrlSubscribe';

/** 订阅数据变化的全局信号：ReaderPage 监听后刷新订阅列表。 */
export function notifyFeedsChanged(): void {
  window.dispatchEvent(new CustomEvent('superman:feeds-changed'));
}

/** 收藏内容变化的全局信号：收藏页（收藏夹）监听后刷新列表。 */
export function notifyClipsChanged(): void {
  window.dispatchEvent(new CustomEvent('superman:clips-changed'));
}

/**
 * 「+」统一面板：收藏 + 订阅页的四个来源，每个 tab 一张自己的列表。
 * 收藏页的空态 / 加号也走这里（带 initialTab='clip'），全站只有这一个添加弹窗。
 */
export type AddTab = 'clip' | 'hot' | 'rss' | 'github' | 'dsh';
const ADD_TABS: ReadonlyArray<readonly [AddTab, string]> = [
  ['clip', '🔖 收藏'],
  ['hot', '🔥 热点新闻'],
  ['rss', '📡 RSS 订阅'],
  ['github', '🐙 GitHub'],
  ['dsh', '🧩 DSH 插件'],
];
const TAB_STORAGE_KEY = 'superman.addsheet.tab';

interface AddSheetProps {
  open: boolean;
  onClose: () => void;
  /** 从订阅页「+」打开时指定的来源 tab（缺省读上次使用记录）。 */
  initialTab?: AddTab;
}

/**
 * 统一「添加」中心（+ 入口）：收藏内容 / 订阅博主 双 tab。
 * 取代旧 PastePanel（收藏弹层）与 FeedsManagerSheet（订阅管理）的新增职责；
 * 已有订阅的管理（启停/删除/OPML）在「我的 → 订阅」。
 */
export default function AddSheet({ open, onClose, initialTab }: AddSheetProps) {
  const [tab, setTab] = useState<AddTab>('clip');

  // 记住上次用的 tab：最高频动作少点一次；带 initialTab 时以调用方为准
  useEffect(() => {
    if (!open) return;
    if (initialTab) { setTab(initialTab); return; }
    try {
      const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
      if (saved && ADD_TABS.some(([key]) => key === saved)) setTab(saved as AddTab);
    } catch { /* 隐私模式忽略 */ }
  }, [open, initialTab]);

  const switchTab = useCallback((next: AddTab) => {
    setTab(next);
    try { window.localStorage.setItem(TAB_STORAGE_KEY, next); } catch { /* 忽略 */ }
  }, []);

  return (
    <GlassDetailSheet open={open} onClose={onClose} ariaLabel="添加">
      <div className="px-5 pb-6 pt-1 sm:px-7">
        <div className="flex items-center gap-2">
          <Plus aria-hidden="true" className="h-4 w-4 text-primary" strokeWidth={2.5} />
          <h2 className="text-base font-semibold text-foreground">添加</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">收藏内容、订阅平台，都从这里进</p>

        <div
          className="mt-3 flex gap-1 overflow-x-auto rounded-full border border-border bg-secondary/60 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {ADD_TABS.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => switchTab(id)}
              className={cn(
                'flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-[11.5px] font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {tab === 'clip' ? <ClipPane /> : null}
        {tab === 'hot' ? <SourcePrefPane source="hot" hint="勾选要看的平台，只有勾选的平台会展示。" /> : null}
        {tab === 'github' ? <SourcePrefPane source="github" hint="勾选关注的分类，只有勾选的分类会展示。" /> : null}
        {tab === 'dsh' ? <SourcePrefPane source="dsh" hint="插件市场目录待同步：中台连接后自动拉取分类。" /> : null}
        {tab === 'rss' ? <SubscribePane /> : null}
      </div>
    </GlassDetailSheet>
  );
}

/* ═══════════════════════ 收藏 pane ═══════════════════════ */

interface SmartResult {
  articleId: number | string;
  title: string;
  kind: string;
  cover?: string | null;
  transcriptPending?: boolean;
  alreadyExists?: boolean;
  creator?: { rssHubUrl: string; nickname: string | null; secUid: string | null } | null;
}

/** 从 DataTransfer / ClipboardEvent 取出图片文件（截图粘贴走 items，拖拽走 files）。 */
function pickImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  if (data.items && data.items.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  if (out.length === 0 && data.files && data.files.length) {
    for (const f of Array.from(data.files)) {
      if (f.type.startsWith('image/')) out.push(f);
    }
  }
  return out;
}

function ClipPane() {
  // 智能框：文字 + 图片（粘贴/拖拽）共用一个入口
  const [smartText, setSmartText] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [smartResult, setSmartResult] = useState<SmartResult | null>(null);
  const [following, setFollowing] = useState(false);
  const [converting, setConverting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // 展开的「更多方式」行（手风琴，一次一个）
  const [expanded, setExpanded] = useState<'text' | 'image' | 'video' | 'product' | null>(null);
  const [textBody, setTextBody] = useState('');
  const [ideaText, setIdeaText] = useState('');
  const [ideaNote, setIdeaNote] = useState('');
  const [video, setVideo] = useState<File | null>(null);
  // 收藏标签（可选）：逗号分隔，随本次收藏写入 clips.tags
  const [clipTags, setClipTags] = useState('');

  const reset = useCallback(() => {
    setSmartText('');
    setImages([]);
    setSourceUrl('');
    setSmartResult(null);
    setTextBody('');
    setIdeaText('');
    setIdeaNote('');
    setVideo(null);
    setClipTags('');
    setExpanded(null);
  }, []);

  // 标签解析：逗号分隔、去 #，最多 10 个；空返回 undefined（不带字段）
  const tagsPayload = useCallback((): string[] | undefined => {
    const tags = clipTags.split(/[,，]/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 10);
    return tags.length > 0 ? tags : undefined;
  }, [clipTags]);

  // 截图粘贴：⌘/Ctrl+V 直接进智能框（面板打开 + 收藏 tab 时生效）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = pickImageFiles(e.clipboardData);
      if (files.length === 0) return; // 纯文本粘贴不拦截
      e.preventDefault();
      setImages((prev) => [...prev, ...files]);
      toast.success(`已粘贴 ${files.length} 张图片，直接点「智能收藏」`);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const addImages = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setImages((prev) => [...prev, ...files]);
    toast.success(`已添加 ${files.length} 张图片`);
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setSmartText(text); setSmartResult(null); toast.success('已粘贴剪贴板内容'); }
    } catch {
      toast.info('无法读取剪贴板，请手动粘贴');
    }
  }, []);

  const uploadImages = useCallback(async (sourceUrlValue: string) => {
    const formData = new FormData();
    images.forEach((f) => formData.append('images', f));
    if (sourceUrlValue) formData.append('sourceUrl', sourceUrlValue);
    const tags = tagsPayload();
    if (tags) formData.append('tags', JSON.stringify(tags));
    const res = await apiFetch('/s/api/clipboard/image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error?.message || '上传失败');
    toast.success('图片已收藏');
    setImages([]);
    setSourceUrl('');
  }, [images, tagsPayload]);

  /** 智能收藏：图片优先；文字含链接走智能识别；纯文本直接归档。 */
  const handleSmartSave = useCallback(async () => {
    if (images.length === 0 && !smartText.trim()) { toast.info('粘贴内容、链接，或直接 ⌘/Ctrl+V 贴截图'); return; }
    setSaving(true);
    try {
      if (images.length > 0) {
        await uploadImages(extractFirstUrl(smartText) ?? '');
        reset();
        return;
      }
      const text = smartText.trim();
      if (extractFirstUrl(text)) {
        // 含链接 → 智能识别（URL/博主/作品），结果块内继续操作
        const res = await apiFetch('/s/api/clipboard/smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, tags: tagsPayload() }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error?.message || '识别失败');
        setSmartResult(data.data as SmartResult);
        notifyClipsChanged();
        toast.success(
          data.data?.kind === 'creator'
            ? '已识别博主'
            : data.data?.alreadyExists
              ? '已在收藏中（复用已有记录）'
              : '已收藏',
        );
        return;
      }
      // 纯文本 → 直接归档到选题库
      const res = await apiFetch('/s/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentText: text, tags: tagsPayload() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || '保存失败');
      toast.success(data.data?.alreadyExists ? '已在收藏中（复用已有记录）' : '已收入收藏夹');
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [images, smartText, uploadImages, reset, tagsPayload]);

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
      toast.success(`已订阅「${creator.nickname || '博主'}」`);
      notifyFeedsChanged();
      setSmartResult((prev) => (prev ? { ...prev, creator: null } : prev));
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setFollowing(false);
    }
  }, [smartResult]);

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

  const handleSaveText = useCallback(async () => {
    if (!textBody.trim()) { toast.info('请输入内容'); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/s/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentText: textBody.trim(), sourceUrl: sourceUrl.trim() || undefined, tags: tagsPayload() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || '保存失败');
      toast.success(data.data?.alreadyExists ? '已在收藏中（复用已有记录）' : '已收入收藏夹');
      notifyClipsChanged();
      setTextBody('');
      setSourceUrl('');
      setExpanded(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [textBody, sourceUrl]);

  const handleSaveImage = useCallback(async () => {
    if (images.length === 0) { toast.info('请选择图片'); return; }
    setSaving(true);
    try {
      await uploadImages(sourceUrl.trim());
      setExpanded(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setSaving(false);
    }
  }, [images, sourceUrl, uploadImages]);

  const handleSaveVideo = useCallback(async () => {
    if (!video) { toast.info('请选择视频文件'); return; }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('video', video);
      if (sourceUrl.trim()) formData.append('sourceUrl', sourceUrl.trim());
      const tags = tagsPayload();
      if (tags) formData.append('tags', JSON.stringify(tags));
      const res = await apiFetch('/s/api/clipboard/video', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || '上传失败');
      toast.success('视频已收藏');
      notifyClipsChanged();
      setVideo(null);
      setSourceUrl('');
      setExpanded(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setSaving(false);
    }
  }, [video, sourceUrl]);

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
      setIdeaText('');
      setIdeaNote('');
      setExpanded(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [ideaText, ideaNote]);

  const moreWays = [
    { key: 'text' as const, badge: '⌨', title: '文本收藏', desc: '长文字、文章片段，支持来源链接' },
    { key: 'image' as const, badge: '🖼', title: '图片收藏', desc: '截图、封面、灵感图，支持多张' },
    { key: 'video' as const, badge: '⬆', title: '视频收藏', desc: '本地视频文件，较少用' },
    { key: 'product' as const, badge: '💡', title: '记录产品计划', desc: '把点子整理成产品规划，含链接自动关联' },
  ];

  return (
    <div>
      {/* 智能框：文字 + 图片共用一个入口 */}
      <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-[13px] font-semibold text-foreground">✨ 智能收藏</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">粘贴链接或分享文字自动识别；截图直接 ⌘/Ctrl+V 或拖进来</p>
        <textarea
          value={smartText}
          onChange={(e) => { setSmartText(e.target.value); setSmartResult(null); }}
          placeholder={'直接粘贴分享内容即可，例如：\n「这个博主… https://v.douyin.com/xxx/ 复制此链接，打开抖音搜索…」'}
          rows={2}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addImages(pickImageFiles(e.dataTransfer)); }}
          className="mt-2.5 w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
        />
        <input
          value={clipTags}
          onChange={(e) => setClipTags(e.target.value)}
          placeholder="标签（可选）：逗号分隔，如 灵感, 落地页"
          className="mt-2 h-9 w-full rounded-xl border border-border bg-card px-3 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
        />
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((f, i) => (
              <div key={i} className="relative h-14 w-14 overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl bg-black/60 text-white"
                  aria-label={`移除第 ${i + 1} 张图片`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={() => void pasteFromClipboard()} className="text-[11px] text-primary hover:underline">
            从剪贴板粘贴
          </button>
          <p className="text-[11px] text-muted-foreground">自动提取链接 · 识别博主 · 收藏作品</p>
        </div>

        {/* 智能识别结果：关注博主 / 一键转产品计划 */}
        {smartResult && (
          <div className="mt-2.5 rounded-xl border border-success/30 bg-success/5 p-3">
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
                <button
                  type="button"
                  onClick={() => void handleFollow()}
                  disabled={following}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {following ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                  关注并订阅{smartResult.creator.nickname ? ` @${smartResult.creator.nickname}` : ''}
                </button>
              )}
              {smartResult.kind !== 'creator' && smartResult.articleId ? (
                <button
                  type="button"
                  onClick={() => void handleConvertToProductPlan()}
                  disabled={converting}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary disabled:opacity-50"
                >
                  {converting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                  生成产品计划
                </button>
              ) : null}
            </div>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => { reset(); }}
            className="h-10 flex-1 rounded-full border border-border text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            {smartResult ? '完成' : '清空'}
          </button>
          <button
            type="button"
            onClick={() => void handleSmartSave()}
            disabled={saving}
            className="inline-flex h-10 flex-[1.6] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            智能收藏
          </button>
        </div>
      </div>

      {/* 更多收藏方式：列表行 + 手风琴展开 */}
      <div className="mt-4 flex items-center gap-2.5 px-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] text-muted-foreground">更多收藏方式</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div>
        {moreWays.map((way) => (
          <div key={way.key}>
            <div
              data-testid={`add-way-${way.key}`}
              className="mt-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5"
            >
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-sm text-primary">
                {way.badge}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{way.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{way.desc}</span>
              </span>
              <button
                type="button"
                onClick={() => setExpanded(expanded === way.key ? null : way.key)}
                aria-expanded={expanded === way.key}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  expanded === way.key
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20',
                )}
              >
                {expanded === way.key ? '收起' : '展开'}
                <ChevronDown aria-hidden="true" className={cn('h-3 w-3 transition-transform', expanded === way.key && 'rotate-180')} />
              </button>
            </div>

            {expanded === way.key && (
              <div className="mt-1.5 space-y-2 rounded-2xl border border-border/50 bg-card/60 p-3.5">
                {way.key === 'text' && (
                  <>
                    <textarea
                      value={textBody}
                      onChange={(e) => setTextBody(e.target.value)}
                      placeholder="粘贴文本内容…"
                      rows={4}
                      className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
                    />
                    <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                      <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <input
                        type="url"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="来源链接（可选）"
                        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveText()}
                      disabled={saving}
                      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 text-sm font-medium text-primary disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
                      保存到收藏
                    </button>
                  </>
                )}
                {way.key === 'image' && (
                  <>
                    <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(Array.from(e.target.files || []))} />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); addImages(pickImageFiles(e.dataTransfer)); }}
                      className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-6 text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      <ImageIcon className="h-5 w-5" aria-hidden="true" />
                      <span className="text-xs">点击选择 / 拖拽图片到此处（可多张）</span>
                    </button>
                    {images.length > 0 && (
                      <p className="text-[11px] text-success">已就绪 {images.length} 张图片</p>
                    )}
                    <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                      <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <input
                        type="url"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="来源链接（可选）"
                        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveImage()}
                      disabled={saving || images.length === 0}
                      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 text-sm font-medium text-primary disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
                      收藏图片
                    </button>
                  </>
                )}
                {way.key === 'video' && (
                  <>
                    <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} />
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-6 text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      <Upload className="h-5 w-5" aria-hidden="true" />
                      <span className="text-xs">{video ? video.name : '点击选择视频文件'}</span>
                    </button>
                    <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                      <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <input
                        type="url"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="来源链接（可选）"
                        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveVideo()}
                      disabled={saving || !video}
                      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 text-sm font-medium text-primary disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
                      收藏视频
                    </button>
                  </>
                )}
                {way.key === 'product' && (
                  <>
                    <textarea
                      value={ideaText}
                      onChange={(e) => setIdeaText(e.target.value)}
                      placeholder={'把你的产品想法写下来，例如：\n做一个帮自媒体人一键把长文转口播稿的工具，面向个人博主…'}
                      rows={4}
                      className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
                    />
                    <input
                      type="text"
                      value={ideaNote}
                      onChange={(e) => setIdeaNote(e.target.value)}
                      placeholder="补充备注 / 约束（可选）：人群、预算、已有资源…"
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
                    />
                    <p className="text-[11px] text-muted-foreground">若想法里含已收藏的链接，会自动关联到那条收藏，不重复入库。</p>
                    <button
                      type="button"
                      onClick={() => void handleCreateIdeaPlan()}
                      disabled={saving}
                      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}
                      生成产品计划
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════ 订阅博主 pane ═══════════════════════ */

const PLATFORM_BADGE: Record<string, string> = {
  bilibili: 'B站', douyin: '抖音', ai: 'AI', tech: '科技', rss: 'RSS',
};

function SubscribePane() {
  const [feeds, setFeeds] = useState<FeedListItem[]>([]);
  const [recommended, setRecommended] = useState<RecommendedFeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [categoryName, setCategoryName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [feedResult, recommendedResult] = await Promise.all([
        listFeedItems({ notifyOnError: false }),
        listRecommendedFeeds({ notifyOnError: false }),
      ]);
      setFeeds(feedResult.items);
      setRecommended(recommendedResult);
    } catch {
      // 静默，保持旧数据
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const subscribedUrls = new Set(feeds.map((item) => item.url));

  const subscribe = useCallback(async (input: { title: string; url: string; siteUrl?: string | null; categoryName?: string }) => {
    setSubmitting(true);
    try {
      await createFeed({
        title: input.title,
        url: input.url,
        siteUrl: input.siteUrl ?? null,
        categoryName: input.categoryName || null,
      });
      toast.success(`已订阅「${input.title}」`);
      notifyFeedsChanged();
      await load();
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setSubmitting(false);
    }
  }, [load]);

  const handleManualSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void subscribe({ title, url, categoryName });
  }, [subscribe, title, url, categoryName]);

  return (
    <div>
      <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-[13px] font-semibold text-foreground">🔗 智能订阅</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">粘贴任意博主链接或分享文字，自动识别平台并订阅</p>
        <div className="mt-2.5">
          <SmartUrlSubscribe onSubscribed={() => { notifyFeedsChanged(); void load(); }} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5 px-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] text-muted-foreground">推荐博主</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {loading ? (
        <div className="space-y-2 pt-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
          ))}
        </div>
      ) : recommended.filter((entry) => !subscribedUrls.has(entry.url)).length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">全部推荐博主都已订阅；管理已订阅去「我的 → 订阅」</p>
      ) : (
        <div>
          {recommended.filter((entry) => !subscribedUrls.has(entry.url)).map((entry) => {
            const subscribed = subscribedUrls.has(entry.url);
            return (
              <div
                key={entry.id}
                data-testid="recommended-row"
                className="mt-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5"
              >
                <span aria-hidden="true" className="inline-flex h-6 shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-2 text-[10px] font-medium text-primary">
                  {PLATFORM_BADGE[entry.platform ?? 'rss'] ?? 'RSS'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{entry.title}</span>
                  {entry.description ? (
                    <span className="block truncate text-[11px] text-muted-foreground">{entry.description}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={subscribed || submitting}
                  onClick={() => void subscribe({ title: entry.title, url: entry.url, siteUrl: entry.siteUrl })}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    subscribed
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.97]',
                    'disabled:pointer-events-none disabled:opacity-60',
                  )}
                >
                  {subscribed ? <><Check className="h-3 w-3" aria-hidden="true" />已订阅</> : '订阅'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 手动订阅：列表行 + 手风琴表单 */}
      <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-sm text-primary">⌨</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">手动订阅</span>
          <span className="block truncate text-[11px] text-muted-foreground">RSS 地址或 rsshub:// 路由，本地 RSSHub 已内置 B站/抖音</span>
        </span>
        <button
          type="button"
          onClick={() => setManualOpen(!manualOpen)}
          aria-expanded={manualOpen}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
        >
          {manualOpen ? '收起' : '展开'}
          <ChevronDown aria-hidden="true" className={cn('h-3 w-3 transition-transform', manualOpen && 'rotate-180')} />
        </button>
      </div>
      {manualOpen && (
        <form onSubmit={handleManualSubmit} className="mt-1.5 space-y-2 rounded-2xl border border-border/50 bg-card/60 p-3.5">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="名称（如：何同学）"
            aria-label="订阅名称"
            required
            className="h-10 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
          />
          <input
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…/feed.xml 或 rsshub:// 路由"
            aria-label="订阅链接"
            required
            className="h-10 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
          />
          <input
            type="text"
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            placeholder="分类（可选，如：视频）"
            aria-label="分类"
            className="h-10 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={submitting || !title.trim() || !url.trim()}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 text-sm font-medium text-primary disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            添加订阅
          </button>
        </form>
      )}
    </div>
  );
}

/* ═══════════════════════ 来源勾选 pane（热点 / GitHub / DSH） ═══════════════════════ */

/**
 * 一个来源一张勾选列表：行样式与「推荐博主」同一套（有底色的卡片行 + 勾选框），
 * 保存后立刻通知订阅页刷新，热点由宿主「保存即采集」补数据。
 */
function SourcePrefPane({ source, hint }: { source: 'hot' | 'github' | 'dsh'; hint: string }) {
  const [catalog, setCatalog] = useState<Array<{ key: string; label: string }>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      listSubscribeCatalog(source, { notifyOnError: false }).catch(() => []),
      listSubscribePrefs({ notifyOnError: false }).catch(() => []),
    ])
      .then(([items, prefRows]) => {
        if (cancelled) return;
        setCatalog(items);
        const saved = prefRows.filter((row) => row.sourceKey === source).map((row) => row.prefKey);
        // 默认全选：从没保存过勾选时，平台/分类全勾上（取消勾选才是不采集）
        setPicked(saved.length > 0 ? saved : items.map((item) => item.key));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const toggle = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await saveSubscribePrefs(source, picked);
      toast.success('已保存，正在按新的勾选采集…');
      window.dispatchEvent(new CustomEvent('superman:prefs-changed', { detail: { source } }));
    } catch {
      // apiClient 已统一 toast
    } finally {
      setSaving(false);
    }
  }, [source, picked]);

  return (
    <div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      {loading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-11 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
          ))}
        </div>
      ) : catalog.length === 0 ? (
        <p className="mt-6 py-6 text-center text-xs text-muted-foreground">目录暂无内容</p>
      ) : (
        <div className="mt-3 space-y-2">
          {catalog.map((item) => {
            const checked = picked.includes(item.key);
            return (
              <button
                key={item.key}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(item.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  checked
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
                  )}
                >
                  {checked ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {source === 'dsh' ? null : (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="inline-flex h-9 items-center rounded-full border border-primary/40 bg-primary/10 px-5 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary/20 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}
