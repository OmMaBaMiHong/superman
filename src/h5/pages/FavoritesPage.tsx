'use client';

/**
 * 收藏页（收藏夹）：把「+ → 收藏」收进来的东西按媒介分类展示。
 *
 * 数据来源两个既有接口，客户端合并（不动 host）：
 *   /s/api/me/favorites → 收藏条目（article 维度：标题/摘要/封面/来源/时间）
 *   /s/api/clips        → 收藏快照（图片数组 / 原文 / 备注），按 articleId 对齐
 * 类型判定：
 *   图片 = 快照里有多张/单张图；视频 = 视频文件收藏（fast-path 标记）；链接 = 有来源 URL；
 *   文案 = 其余纯文本。点开详情复用 ContentDetailSheet（视频走统一视频面板，图片看大图）。
 *
 * 版式：瀑布流（CSS columns）——图片/视频按原图比例占高，文案/链接卡片矮，混排时刚好补空洞。
 * 卡片操作：hover 出「编辑（标题/备注）」「删除」；删除走后端 DELETE /s/api/favorites/:id。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark, FolderSymlink, Image as ImageIcon, Link2, Loader2, PencilLine, Play, Plus, RefreshCw, Trash2, Type,
} from 'lucide-react';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import ContentDetailSheet from '@/features/contents/components/ContentDetailSheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { apiFetch } from '../lib/auth';
import { mediaUrl } from '@/lib/mediaUrl';
import { navigateTo } from '../lib/router';
import MemoTimeline from '../components/MemoTimeline';
import MemoCalendar from '../components/MemoCalendar';

interface FavoriteItem {
  id: string;
  title: string | null;
  sourceUrl: string | null;
  origin: string;
  isFavorited: boolean;
  previewImageUrl: string | null;
  summary: string | null;
  userNote: string | null;
  createdAt: string;
}

interface ClipItem {
  id: string;
  articleId: string;
  rawContent: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  imageUrls: string[] | null;
  note: string | null;
  createdAt: string;
}

type Kind = 'image' | 'video' | 'text' | 'link';
type KindFilter = 'all' | Kind;

interface Entry {
  item: FavoriteItem;
  clip: ClipItem | undefined;
  kind: Kind;
}

const KIND_TABS: ReadonlyArray<readonly [KindFilter, string]> = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['text', '文案'],
  ['link', '链接'],
];

type MemoView = 'timeline' | 'calendar' | 'fav';
const VIEW_TABS: ReadonlyArray<readonly [MemoView, string]> = [
  ['timeline', '时间线'],
  ['calendar', '日历'],
  ['fav', '收藏'],
];

const KIND_META: Record<Kind, { label: string; Icon: typeof ImageIcon; className: string }> = {
  image: { label: '图片', Icon: ImageIcon, className: 'border-sky-400/40 bg-sky-400/10 text-sky-600 dark:text-sky-300' },
  video: { label: '视频', Icon: Play, className: 'border-violet-400/40 bg-violet-400/10 text-violet-600 dark:text-violet-300' },
  text: { label: '文案', Icon: Type, className: 'border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300' },
  link: { label: '链接', Icon: Link2, className: 'border-primary/40 bg-primary/10 text-primary' },
};

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : date.toLocaleDateString('zh-CN');
}

function clipImages(clip: ClipItem | undefined): string[] {
  return Array.isArray(clip?.imageUrls) ? clip!.imageUrls!.filter((url) => typeof url === 'string' && url) : [];
}

function classify(item: FavoriteItem, clip: ClipItem | undefined): Kind {
  const images = clipImages(clip);
  const raw = clip?.rawContent ?? '';
  if (images.length > 0) return 'image';
  // 视频收藏由 /s/api/clipboard/video 写入，快照正文固定以「视频素材：」开头
  if (raw.startsWith('视频素材：')) return 'video';
  if (item.sourceUrl) return 'link';
  if (raw.trim() || item.summary) return 'text';
  if (item.previewImageUrl) return 'image';
  return 'link';
}

interface CardProps {
  entry: Entry;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}

function KindBadge({ kind }: { kind: Kind }) {
  const meta = KIND_META[kind];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', meta.className)}>
      <meta.Icon aria-hidden="true" className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function Card({ entry, onOpen, onEdit, onDelete, deleting }: CardProps) {
  const { item, clip, kind } = entry;
  const images = clipImages(clip);
  const title = item.title || clip?.sourceTitle || '未命名收藏';
  const raw = (clip?.rawContent ?? '').trim();
  const host = hostOf(item.sourceUrl);

  const actions = (
    <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
      <button
        type="button"
        aria-label="编辑收藏"
        title="编辑标题/备注"
        onClick={(event) => { event.stopPropagation(); onEdit(); }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-primary"
      >
        <PencilLine aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="删除收藏"
        title="删除"
        disabled={deleting}
        onClick={(event) => { event.stopPropagation(); onDelete(); }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-error disabled:opacity-50"
      >
        {deleting ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  const shell = 'block w-full overflow-hidden rounded-2xl border border-border/60 bg-card text-left transition-shadow hover:shadow-md';

  return (
    <div className="group relative mb-3 break-inside-avoid">
      {actions}
      {kind === 'image' ? (
        <button type="button" onClick={onOpen} className={shell}>
          <span className="relative block bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(images[0])} alt="" loading="lazy" className="block w-full object-cover" />
            {images.length > 1 ? (
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white">
                {images.length} 张
              </span>
            ) : null}
          </span>
          <span className="block p-3">
            <span className="flex items-center gap-2">
              <KindBadge kind={kind} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</span>
            </span>
            {item.userNote ? <span className="mt-1 block truncate text-[11px] text-muted-foreground">备注：{item.userNote}</span> : null}
            <span className="mt-1 block text-[10.5px] text-muted-foreground">{dateLabel(item.createdAt)}</span>
          </span>
        </button>
      ) : kind === 'video' ? (
        <button type="button" onClick={onOpen} className={shell}>
          <span className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-secondary/80 to-muted">
            {item.previewImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(item.previewImageUrl)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            ) : null}
            <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              <Play aria-hidden="true" className="h-5 w-5" />
            </span>
          </span>
          <span className="block p-3">
            <span className="flex items-center gap-2">
              <KindBadge kind={kind} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</span>
            </span>
            {item.userNote ? <span className="mt-1 block truncate text-[11px] text-muted-foreground">备注：{item.userNote}</span> : null}
            <span className="mt-1 block text-[10.5px] text-muted-foreground">{dateLabel(item.createdAt)}</span>
          </span>
        </button>
      ) : kind === 'text' ? (
        <button type="button" onClick={onOpen} className={cn(shell, 'p-3.5')}>
          <span className="flex items-center gap-2">
            <KindBadge kind={kind} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground">{title}</span>
          </span>
          <span className="mt-2 block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:8] overflow-hidden">
            {raw || item.summary || '（空内容）'}
          </span>
          {item.userNote ? <span className="mt-2 block truncate text-[11px] text-primary/90">备注：{item.userNote}</span> : null}
          <span className="mt-2 block text-[10.5px] text-muted-foreground">
            {dateLabel(item.createdAt)}
            {host ? ` · ${host}` : ''}
          </span>
        </button>
      ) : (
        <button type="button" onClick={onOpen} className={cn(shell, 'p-3.5')}>
          <span className="flex items-center gap-2">
            <KindBadge kind={kind} />
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">{host ?? '链接'}</span>
          </span>
          <span className="mt-2 block text-[13.5px] font-semibold leading-snug text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
            {title}
          </span>
          {item.summary ? (
            <span className="mt-1.5 block text-[12px] leading-relaxed text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
              {item.summary}
            </span>
          ) : null}
          {item.userNote ? <span className="mt-2 block truncate text-[11px] text-primary/90">备注：{item.userNote}</span> : null}
          <span className="mt-2 block text-[10.5px] text-muted-foreground">{dateLabel(item.createdAt)}</span>
        </button>
      )}
    </div>
  );
}

export default function FavoritesPage() {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [clips, setClips] = useState<Map<string, ClipItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<FavoriteItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNote, setEditNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 保存目录：null=未知，''=未设置（提示去关联 Obsidian vault）
  const [saveDir, setSaveDir] = useState<string | null>(null);
  // 随记页三视图：时间线（快速记+流）/ 日历（规划）/ 收藏（素材瀑布流）
  const [view, setView] = useState<MemoView>('timeline');

  const load = useCallback(async () => {
    try {
      const [favRes, clipRes] = await Promise.all([
        apiFetch('/s/api/me/favorites?limit=100'),
        apiFetch('/s/api/clips?limit=100'),
      ]);
      const favJson = await favRes.json();
      const clipJson = await clipRes.json();
      const favItems = (favJson?.ok ? favJson.data.items : []) as FavoriteItem[];
      const clipItems = (clipJson?.ok ? clipJson.data.items : []) as ClipItem[];
      setItems(favItems);
      setClips(new Map(clipItems.map((clip) => [String(clip.articleId), clip])));
    } catch {
      // 静默：保留旧数据
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const [maintaining, setMaintaining] = useState(false);

  /** 整理已有收藏：老图/视频复制进保存目录 + 给视频补首帧封面。 */
  const maintainFavorites = useCallback(async () => {
    setMaintaining(true);
    try {
      const res = await apiFetch('/s/api/me/favorites/maintenance', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? '整理失败');
      const { notes, posters, hasDir } = json.data as { notes: number; posters: number; hasDir: boolean };
      toast.success(
        hasDir
          ? `已整理：${notes} 条写入目录、${posters} 个视频封面`
          : `已生成 ${posters} 个视频封面（未配置目录）`,
      );
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '整理失败');
    } finally {
      setMaintaining(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiFetch('/s/api/me/favorites/dir')
      .then((res) => res.json())
      .then((json) => { if (json.ok) setSaveDir(typeof json.data.dir === 'string' ? json.data.dir : ''); })
      .catch(() => setSaveDir(''));
    const onDirChanged = () => {
      apiFetch('/s/api/me/favorites/dir')
        .then((res) => res.json())
        .then((json) => { if (json.ok) setSaveDir(typeof json.data.dir === 'string' ? json.data.dir : ''); })
        .catch(() => {});
    };
    window.addEventListener('superman:favorites-dir-changed', onDirChanged);
    return () => window.removeEventListener('superman:favorites-dir-changed', onDirChanged);
  }, []);

  // 「+ → 收藏」保存后刷新
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener('superman:clips-changed', onChanged);
    window.addEventListener('superman:feeds-changed', onChanged);
    return () => {
      window.removeEventListener('superman:clips-changed', onChanged);
      window.removeEventListener('superman:feeds-changed', onChanged);
    };
  }, [load]);

  // 唯一的添加入口：全站那个「+」弹窗，指定落在「收藏」tab
  const openAddSheet = useCallback(() => {
    window.dispatchEvent(new CustomEvent('superman:open-add', { detail: { tab: 'clip' } }));
  }, []);

  const openEdit = useCallback((item: FavoriteItem) => {
    setEditItem(item);
    setEditTitle(item.title ?? '');
    setEditNote(item.userNote ?? '');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editItem) return;
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/s/api/articles/${editItem.id}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, note: editNote }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? '保存失败');
      toast.success('已保存');
      setEditItem(null);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingEdit(false);
    }
  }, [editItem, editTitle, editNote, load]);

  const remove = useCallback(async (item: FavoriteItem) => {
    if (!window.confirm(`删除这条收藏？\n${item.title ?? item.sourceUrl ?? ''}`)) return;
    setDeletingId(item.id);
    try {
      const res = await apiFetch(`/s/api/favorites/${item.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? '删除失败');
      toast.success(json.data?.mode === 'unfavorited' ? '已取消收藏' : '已删除');
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  }, [load]);

  const entries = useMemo<Entry[]>(
    () => items.map((item) => {
      const clip = clips.get(String(item.id));
      return { item, clip, kind: classify(item, clip) };
    }),
    [items, clips],
  );

  const counts = useMemo(() => {
    const result: Record<KindFilter, number> = { all: entries.length, image: 0, video: 0, text: 0, link: 0 };
    for (const entry of entries) result[entry.kind] += 1;
    return result;
  }, [entries]);

  const visible = kind === 'all' ? entries : entries.filter((entry) => entry.kind === kind);

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <Bookmark aria-hidden="true" className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-semibold">随记</h1>
        {view === 'fav' ? <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{counts.all} 条</span> : null}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex gap-0.5 rounded-full bg-muted/50 p-0.5">
            {VIEW_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  view === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="添加收藏"
            title="添加收藏"
            onClick={openAddSheet}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            添加
          </button>
          {view === 'fav' ? (
            <button
              type="button"
              aria-label="刷新收藏"
              title="刷新"
              onClick={() => { setRefreshing(true); void load(); }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-primary"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      {/* 类型筛选（带计数）：图片 / 视频 / 文案 / 链接（仅收藏视图） */}
      <div className={cn('flex shrink-0 gap-1.5 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', view !== 'fav' && 'hidden')}>
        {KIND_TABS.map(([key, label]) => {
          const active = kind === key;
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(key)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              <span className="font-mono text-[10px] tabular-nums opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {view === 'timeline' ? (
          <MemoTimeline />
        ) : view === 'calendar' ? (
          <MemoCalendar />
        ) : (
          <>
        {saveDir !== null ? (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 text-[12px] text-muted-foreground">
            <FolderSymlink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={saveDir || undefined}>
              {saveDir ? <>存到：<span className="text-foreground">{saveDir}</span></> : '未设置本地保存目录，收藏仅存插件数据库'}
            </span>
            <button
              type="button"
              onClick={() => { void maintainFavorites(); }}
              disabled={maintaining}
              className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              {maintaining ? '整理中…' : '整理'}
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/settings')}
              className="shrink-0 text-xs font-medium text-primary hover:underline"
            >
              {saveDir ? '改目录' : '去设置'}
            </button>
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <button
            type="button"
            onClick={openAddSheet}
            className="mx-auto block w-full max-w-md rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <Bookmark aria-hidden="true" className="mx-auto h-6 w-6 text-muted-foreground/70" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {counts.all === 0 ? '还没有收藏内容' : `没有${KIND_TABS.find(([key]) => key === kind)?.[1] ?? ''}类收藏`}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              点这里（或右上角「+」）打开收藏面板：粘贴链接 / 文字、截图 ⌘V、拖入视频，收进来的都会出现在这里；随手想记的去「时间线」。
            </p>
          </button>
        ) : (
          /* 瀑布流列数：默认 3 列（插件面板宽度约 1000px），超宽屏 4 列，窄屏退 2 列 */
          <div className="columns-2 gap-2.5 sm:columns-3 xl:columns-4 2xl:columns-5">
            {visible.map((entry) => (
              <Card
                key={entry.item.id}
                entry={entry}
                onOpen={() => setDetailId(entry.item.id)}
                onEdit={() => openEdit(entry.item)}
                onDelete={() => void remove(entry.item)}
                deleting={deletingId === entry.item.id}
              />
            ))}
          </div>
        )}
          </>
        )}
      </main>

      <ContentDetailSheet articleId={detailId} onClose={() => setDetailId(null)} />

      {/* 编辑标题 / 备注（备注会进「生成稿件」提示词） */}
      <GlassDetailSheet open={editItem !== null} onClose={() => setEditItem(null)} ariaLabel="编辑收藏">
        <div className="px-5 pb-8 pt-2 sm:px-7">
          <h2 className="text-base font-semibold text-foreground">编辑收藏</h2>
          <label className="mt-4 block">
            <span className="text-[11px] font-medium text-muted-foreground">标题</span>
            <input
              type="text"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              placeholder="标题"
              className="mt-1 h-10 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-[11px] font-medium text-muted-foreground">备注 / 想法</span>
            <textarea
              rows={5}
              value={editNote}
              onChange={(event) => setEditNote(event.target.value)}
              placeholder="为什么收它、想怎么用…"
              className="mt-1 w-full resize-y rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
            />
          </label>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditItem(null)}
              className="inline-flex h-9 items-center rounded-full border border-border px-4 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={savingEdit}
              className="inline-flex h-9 items-center rounded-full border border-primary/40 bg-primary/10 px-5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {savingEdit ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </GlassDetailSheet>
    </div>
  );
}
