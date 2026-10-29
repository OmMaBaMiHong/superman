'use client';

/**
 * 随记时间线（flomo 式）：顶部快速输入（正文 #标签 自动识别，可选定时间→计划）
 * + 按日期分组的时间线流。记忆锚点 = 收录日期。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';
import { apiFetch } from '../lib/auth';

export interface MemoItem {
  id: number;
  kind: 'note' | 'plan';
  content: string;
  tags: string[];
  articleId: number | null;
  articleTitle: string | null;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
}

const INLINE_TAG_RE = /#([^#\s，。；！？、,;!?…"']{1,24})/g;

export function parseInlineTagsClient(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(INLINE_TAG_RE)) out.add(m[1]);
  return [...out];
}

function dayGroupLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return '今天';
  if (same(d, yesterday)) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function dueLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 快速输入：正文 + #标签 + 可选时间（定了时间即「计划」）。 */
function Composer({ onCreated }: { onCreated: () => void }) {
  const [content, setContent] = useState('');
  const [withTime, setWithTime] = useState(false);
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);

  const tags = useMemo(() => parseInlineTagsClient(content), [content]);

  const submit = useCallback(async () => {
    const text = content.trim();
    if (!text) return;
    setSaving(true);
    try {
      const res = await apiFetch('/s/api/memos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          dueAt: withTime && dueAt ? new Date(dueAt).toISOString() : undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? '保存失败');
      toast.success(withTime && dueAt ? '已加入日历计划' : '已记下');
      setContent('');
      setWithTime(false);
      setDueAt('');
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [content, withTime, dueAt, onCreated]);

  return (
    <div className="glass-surface rounded-2xl p-3">
      <textarea
        rows={2}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit();
        }}
        placeholder="记点什么… #标签 打标签"
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              #{tag}
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={withTime}
          onClick={() => setWithTime((v) => !v)}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
            withTime ? 'border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          时间
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !content.trim()}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
          记一条
        </button>
      </div>
      {withTime ? (
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
          className="mt-2 h-9 w-full rounded-xl border border-border bg-card px-3 text-[12px] text-foreground focus-visible:border-primary focus-visible:outline-none"
        />
      ) : null}
    </div>
  );
}

function MemoCard({ memo, onChanged }: { memo: MemoItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const toggleDone = useCallback(async () => {
    setBusy(true);
    try {
      await apiFetch(`/s/api/memos/${memo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !memo.doneAt }),
      });
      onChanged();
    } catch {
      toast.error('操作失败');
    } finally {
      setBusy(false);
    }
  }, [memo.id, memo.doneAt, onChanged]);

  const remove = useCallback(async () => {
    if (!window.confirm('删除这条随记？')) return;
    setBusy(true);
    try {
      await apiFetch(`/s/api/memos/${memo.id}`, { method: 'DELETE' });
      onChanged();
    } catch {
      toast.error('删除失败');
    } finally {
      setBusy(false);
    }
  }, [memo.id, onChanged]);

  const isPlan = memo.kind === 'plan';

  return (
    <div className="glass-surface group rounded-2xl p-3">
      <div className="flex items-start gap-2.5">
        {isPlan ? (
          <button
            type="button"
            aria-label={memo.doneAt ? '标记未完成' : '标记完成'}
            onClick={() => void toggleDone()}
            disabled={busy}
            className={cn(
              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
              memo.doneAt ? 'border-primary bg-primary text-primary-foreground' : 'border-amber-400/60 text-transparent hover:bg-amber-400/10',
            )}
          >
            <Check className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className={cn('whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground', isPlan && memo.doneAt && 'text-muted-foreground line-through')}>
            {memo.content}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {isPlan && memo.dueAt ? (
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                memo.doneAt ? 'bg-muted text-muted-foreground' : 'bg-amber-400/10 text-amber-600 dark:text-amber-300',
              )}>
                <CalendarClock className="h-3 w-3" aria-hidden="true" />
                {dueLabel(memo.dueAt)}
              </span>
            ) : null}
            {memo.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-secondary-foreground">#{tag}</span>
            ))}
            {memo.articleTitle ? (
              <span className="max-w-full truncate rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                📌 {memo.articleTitle}
              </span>
            ) : null}
            <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">{timeLabel(memo.createdAt)}</span>
            <button
              type="button"
              aria-label="删除随记"
              onClick={() => void remove()}
              disabled={busy}
              className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MemoTimeline({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<MemoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/s/api/memos?limit=100');
      const json = await res.json();
      if (json.ok) setItems((json.data.items ?? []) as MemoItem[]);
    } catch {
      // 静默：保留旧数据
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const groups = useMemo(() => {
    const map = new Map<string, MemoItem[]>();
    for (const memo of items) {
      const key = memo.createdAt.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(memo);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div className="space-y-3">
      <Composer onCreated={() => { setRefreshing(true); void load(); }} />

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{items.length} 条随记</span>
        <button
          type="button"
          aria-label="刷新随记"
          onClick={() => { setRefreshing(true); void load(); }}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-primary"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">还没有随记，在上面记第一条吧</p>
      ) : (
        groups.map(([day, memos]) => (
          <div key={day}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <span className="text-[11px] font-medium text-muted-foreground">{dayGroupLabel(memos[0].createdAt)}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">{day}</span>
              <span className="h-px flex-1 bg-border/60" />
            </div>
            <div className="space-y-2">
              {memos.map((memo) => (
                <MemoCard key={memo.id} memo={memo} onChanged={() => void load()} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
