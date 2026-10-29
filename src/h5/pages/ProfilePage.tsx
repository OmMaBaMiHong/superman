'use client';

import { Bell, ChevronRight, FileText, Heart, Lightbulb, Loader2, LogOut, PenLine, Pencil, Rss, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  createRewriteJobs,
  generateProductPlanFromArticle,
  updateArticleNote,
  type RewritePlatform,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import ContentDetailSheet from '@/features/contents/components/ContentDetailSheet';
import { toast } from '@/features/toast/toast';
import { apiFetch, logoutH5 } from '../lib/auth';
import { navigateTo } from '../lib/router';
import PlatformAccountsPanel from '../components/PlatformAccountsPanel';
import PlatformCollectCookies from '../components/PlatformCollectCookies';
import FreeModelsPanel from '../components/FreeModelsPanel';
import SubscriptionsPanel from '../components/SubscriptionsPanel';
import ServicesPanel from '../components/ServicesPanel';
import RelayPanel from '../components/RelayPanel';
import MembershipCard from '../components/MembershipCard';
import FavoriteDirPanel from '../components/FavoriteDirPanel';
import MyDataPanel from '../components/MyDataPanel';

/**
 * 「我的」页面 — 个人数据中心。
 * 四个子标签：我的作品 / 收藏 / 订阅 / 数据。
 * 设置入口在右上角齿轮按钮。
 */
export default function H5ProfilePage({ username }: { username: string | null }) {
  // 「我的数据」是本页核心，默认落在数据 Tab
  const [subTab, setSubTab] = useState<'works' | 'favorites' | 'subscriptions' | 'stats'>('stats');

  // 统计数据
  const [stats, setStats] = useState({ works: 0, favorites: 0, published: 0 });

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch('/s/api/me/stats');
        const data = await res.json();
        if (data.ok && data.data) {
          // 字段级兜底：后端字段缺失时保持 0，不让统计面板崩掉整页
          const d = data.data as Record<string, unknown>;
          setStats({
            works: typeof d.works === 'number' ? d.works : 0,
            favorites: typeof d.favorites === 'number' ? d.favorites : 0,
            published: typeof d.published === 'number' ? d.published : 0,
          });
        }
      } catch {
        // 静默，保持 0
      }
    })();
  }, []);

  const handleLogout = useCallback(() => {
    void logoutH5().finally(() => {
      navigateTo('/login');
      window.location.reload();
    });
  }, []);

  // ── Chaos 数据中台账号绑定（双身份：本地登录 + 中台授权；订阅等行为的规范身份链）──
  const [chaosLinked, setChaosLinked] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/s/api/chaos/auth/me');
        const json = (await res.json()) as { ok?: boolean; data?: { linked?: boolean } };
        if (!cancelled) setChaosLinked(Boolean(json.ok && json.data?.linked));
      } catch {
        if (!cancelled) setChaosLinked(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 授权回来（hash 带 chaos=linked）刷新绑定状态
  useEffect(() => {
    if (!window.location.hash.includes('chaos=linked')) return undefined;
    void (async () => {
      try {
        const res = await apiFetch('/s/api/chaos/auth/me');
        const json = (await res.json()) as { ok?: boolean; data?: { linked?: boolean } };
        setChaosLinked(Boolean(json.ok && json.data?.linked));
      } catch {
        setChaosLinked(false);
      }
    })();
    return undefined;
  }, []);

  const connectChaos = useCallback(() => {
    void (async () => {
      try {
        const res = await apiFetch('/s/api/chaos/auth/start');
        const json = (await res.json()) as { ok?: boolean; data?: { authorizationUrl?: string } };
        if (json.ok && json.data?.authorizationUrl) {
          window.location.href = json.data.authorizationUrl;
        }
      } catch {
        // 静默：按钮保持可点
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        {/* 头部：头像 + 用户名 + 设置按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
              {username ? username.slice(0, 1).toUpperCase() : 'U'}
            </div>
            <div>
              <h1 className="text-base font-semibold">{username ?? '用户'}</h1>
              <p className="text-[11px] text-muted-foreground">DSH 插件伺服</p>
            </div>
          </div>
        </div>

        {/* 中转站会员卡：授权入口 + 订阅列表（授权管理在设置抽屉同一张卡） */}
        <div className="mt-4">
          <MembershipCard
            onOpenSettings={() => document.getElementById('profile-settings')?.scrollIntoView({ behavior: 'smooth' })}
          />
        </div>

        {/* 数据中台账号（Chaos）：绑定后推荐/素材行为带中台用户身份 */}
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">数据中台账号</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {chaosLinked === null
                ? '检查绑定状态…'
                : chaosLinked
                  ? '已绑定中台账号，推荐与素材按你的授权提供'
                  : '绑定后推荐与素材行为带中台用户身份'}
            </p>
          </div>
          <button
            type="button"
            onClick={connectChaos}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-4 text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]"
          >
            {chaosLinked ? '重新授权' : '去授权'}
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setSubTab('favorites')}
            className="glass-surface flex flex-col items-center rounded-2xl px-3 py-3 transition-colors hover:bg-accent md:flex-row md:justify-center md:gap-3 md:py-4"
          >
            <Heart className="h-4 w-4 text-error" />
            <span className="mt-1 text-lg font-semibold tabular-nums">{stats.favorites}</span>
            <span className="text-[10px] text-muted-foreground">收藏</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('works')}
            className="glass-surface flex flex-col items-center rounded-2xl px-3 py-3 transition-colors hover:bg-accent md:flex-row md:justify-center md:gap-3 md:py-4"
          >
            <PenLine className="h-4 w-4 text-primary" />
            <span className="mt-1 text-lg font-semibold tabular-nums">{stats.works}</span>
            <span className="text-[10px] text-muted-foreground">创作</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('stats')}
            className="glass-surface flex flex-col items-center rounded-2xl px-3 py-3 transition-colors hover:bg-accent md:flex-row md:justify-center md:gap-3 md:py-4"
          >
            <TrendingUp className="h-4 w-4 text-success" />
            <span className="mt-1 text-lg font-semibold tabular-nums">{stats.published}</span>
            <span className="text-[10px] text-muted-foreground">发布</span>
          </button>
        </div>

        {/* 子标签切换 */}
        <div className="mt-5 flex gap-1 rounded-full bg-muted/50 p-1">
          {([
            { key: 'works', label: '我的作品', Icon: PenLine },
            { key: 'favorites', label: '收藏', Icon: Heart },
            { key: 'subscriptions', label: '订阅', Icon: Rss },
            { key: 'stats', label: '数据', Icon: TrendingUp },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-medium transition-colors ${
                subTab === tab.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* 子标签内容 */}
        <div className="mt-4">
          {subTab === 'works' && <WorksList />}
          {subTab === 'favorites' && <FavoritesList />}
          {subTab === 'subscriptions' && <SubscriptionsPanel />}
          {subTab === 'stats' && <MyDataPanel />}
        </div>

        {/* 设置平摊（原抽屉改平铺）：中转站 / 服务与同步 / AI 模型 / 收藏目录 / 平台授权 */}
        <div id="profile-settings" className="mt-8 space-y-5 border-t border-border/60 pt-6">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">设置</h2>
          <RelayPanel />
          <ServicesPanel />
          <FreeModelsPanel />
          <FavoriteDirPanel />
          <div className="space-y-3">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              授权与凭证
            </h3>
            <PlatformAccountsPanel />
            <PlatformCollectCookies />
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-error/30 text-sm font-medium text-error transition-colors hover:bg-error/10"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </main>
    </div>
  );
}

/** 作品项（来自 /s/api/drafts）。 */
interface DraftItem {
  id: number | string;
  title: string | null;
  platform: string | null;
  status: string | null;
  createdAt: string | null;
}

const DRAFT_PLATFORM_LABEL: Record<string, string> = {
  wechat: '公众号',
  xhs: '小红书',
  novel: '小说化',
};

const DRAFT_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  accepted: '已采用',
  exported: '已导出',
};

/** 我的作品列表 */
function WorksList() {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch('/s/api/drafts?pageSize=50');
        const data = await res.json();
        if (data.ok) setItems((data.data.items ?? []) as DraftItem[]);
      } catch {
        // 静默
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState message="还没有作品，去创作台试试吧" />;
  }

  return (
    <div className="space-y-2 md:grid md:grid-cols-2 md:gap-2 md:space-y-0">
      {items.map((item) => {
        const platform = item.platform ? DRAFT_PLATFORM_LABEL[item.platform] ?? item.platform : '草稿';
        const status = item.status ? DRAFT_STATUS_LABEL[item.status] ?? item.status : '';
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => navigateTo('/studio?tab=drafts')}
            className="glass-surface flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <PenLine className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.title || '未命名草稿'}</p>
              <p className="text-[11px] text-muted-foreground">
                {platform}
                {status ? ` · ${status}` : ''}
                {item.createdAt ? ` · ${formatDate(item.createdAt)}` : ''}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}

/** 收藏项（来自 /s/api/me/favorites）。 */
interface FavoriteItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  origin: string;
  isFavorited: boolean;
  previewImageUrl: string | null;
  summary: string | null;
  userNote: string | null;
  directionKey: string | null;
  createdAt: string;
}

const REWRITE_PLATFORM_OPTIONS: Array<{ id: RewritePlatform; name: string }> = [
  { id: 'wechat', name: '公众号' },
  { id: 'xhs', name: '小红书' },
  { id: 'novel', name: '小说化' },
];

/** 收藏列表：可编辑备注/想法、一键转产品规划、生成稿件。 */
function FavoritesList() {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<FavoriteItem | null>(null);
  const [pickerItem, setPickerItem] = useState<FavoriteItem | null>(null);
  const [detailItem, setDetailItem] = useState<FavoriteItem | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/s/api/me/favorites?limit=50');
      const data = await res.json();
      if (data.ok) setItems(data.data.items as FavoriteItem[]);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConvert = useCallback((item: FavoriteItem) => {
    setConvertingId(item.id);
    void generateProductPlanFromArticle(item.id)
      .then((result) => {
        toast.success(result.alreadyExists ? '该内容已有产品计划' : `已生成产品计划：${result.plan.title}`);
      })
      .catch(() => {})
      .finally(() => setConvertingId(null));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState message="还没有收藏，点 + 按钮粘贴内容吧" />;
  }

  return (
    <div className="space-y-2 md:grid md:grid-cols-2 md:gap-2 md:space-y-0">
      {items.map((item) => (
        <div key={item.id} className="glass-surface rounded-2xl p-3">
          <button
            type="button"
            onClick={() => setDetailItem(item)}
            className="flex w-full items-center gap-3 text-left"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-error/10">
              {item.previewImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewImageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Heart className="h-4 w-4 text-error" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {item.origin === 'clipboard' ? '粘贴收藏' : 'RSS 收藏'}
                {item.createdAt ? ` · ${formatDate(item.createdAt)}` : ''}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>

          {item.userNote ? (
            <p className="mt-2 line-clamp-2 rounded-xl bg-secondary/50 px-3 py-2 text-[11px] leading-relaxed text-secondary-foreground">
              💡 {item.userNote}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
            <button
              type="button"
              onClick={() => setDetailItem(item)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <FileText className="h-3 w-3" />
              详情
            </button>
            <button
              type="button"
              onClick={() => setEditItem(item)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              {item.userNote ? '编辑想法' : '加想法'}
            </button>
            <button
              type="button"
              disabled={convertingId === item.id}
              onClick={() => handleConvert(item)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-3 text-[11px] font-medium text-warning disabled:opacity-50"
            >
              <Lightbulb className="h-3 w-3" />
              转产品规划
            </button>
            <button
              type="button"
              onClick={() => setPickerItem(item)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 text-[11px] font-medium text-primary"
            >
              <PenLine className="h-3 w-3" />
              生成稿件
            </button>
          </div>
        </div>
      ))}

      {editItem ? (
        <EditNoteSheet item={editItem} onClose={() => setEditItem(null)} onSaved={() => void load()} />
      ) : null}
      {pickerItem ? <RewritePickerSheet item={pickerItem} onClose={() => setPickerItem(null)} /> : null}
      <ContentDetailSheet
        articleId={detailItem?.id ?? null}
        onClose={() => setDetailItem(null)}
        onGenerate={() => {
          if (detailItem) {
            setPickerItem(detailItem);
            setDetailItem(null);
          }
        }}
      />
    </div>
  );
}

/** 编辑收藏备注 / 想法（会作为生成稿件的用户要求注入提示词）。 */
function EditNoteSheet({ item, onClose, onSaved }: { item: FavoriteItem; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(item.userNote ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(() => {
    setSaving(true);
    void updateArticleNote(item.id, { note: note.trim() })
      .then(() => {
        toast.success('已保存想法');
        onSaved();
        onClose();
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  }, [item.id, note, onSaved, onClose]);

  return (
    <GlassDetailSheet open onClose={onClose} ariaLabel="编辑收藏想法">
      <div className="space-y-3 px-5 pb-6 pt-1 sm:px-7">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">加个想法 / 备注</h2>
        </div>
        <p className="line-clamp-2 text-[12px] text-muted-foreground">{item.title}</p>
        <textarea
          rows={5}
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="收藏时没想到的思路，现在补上，比如：这条适合做成短剧 / 口播选题是……"
          className="w-full resize-y rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground">这段想法会在「生成稿件」时作为你的要求注入提示词。</p>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <button type="button" onClick={onClose} className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm text-muted-foreground">
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5 text-sm font-medium text-primary disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存
          </button>
        </div>
      </div>
    </GlassDetailSheet>
  );
}

/** 选择平台生成稿件。 */
function RewritePickerSheet({ item, onClose }: { item: FavoriteItem; onClose: () => void }) {
  const [submitting, setSubmitting] = useState<RewritePlatform | null>(null);

  const handlePick = useCallback(
    (platform: RewritePlatform) => {
      setSubmitting(platform);
      void createRewriteJobs({ articleId: item.id, platforms: [platform] })
        .then(() => {
          toast.success('已提交生成，去创作台「草稿箱」看结果');
          onClose();
        })
        .catch(() => {})
        .finally(() => setSubmitting(null));
    },
    [item.id, onClose],
  );

  return (
    <GlassDetailSheet open onClose={onClose} ariaLabel="生成稿件">
      <div className="space-y-3 px-5 pb-6 pt-1 sm:px-7">
        <div className="flex items-center gap-2">
          <PenLine className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">生成稿件</h2>
        </div>
        <p className="text-[12px] text-muted-foreground">
          选择目标平台，AI 会按平台风格改写这篇收藏{item.userNote ? '（并带上你的想法）' : ''}。
        </p>
        <div className="grid grid-cols-3 gap-2">
          {REWRITE_PLATFORM_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={submitting !== null}
              onClick={() => handlePick(option.id)}
              className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-border text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
            >
              {submitting === option.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {option.name}
            </button>
          ))}
        </div>
      </div>
    </GlassDetailSheet>
  );
}

/** 2026-09-18T... → 2026-09-18 */
function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Bell className="h-10 w-10 text-muted-foreground/40" />
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
