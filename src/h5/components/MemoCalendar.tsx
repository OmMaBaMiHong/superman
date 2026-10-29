'use client';

/**
 * 随记月历：计划醒目（琥珀色数字）+ 当天收录过东西标点（记忆锚点）。
 * 点日期看当天全部：到期的计划 / 当天记的随记 / 当天收藏的内容。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '../lib/auth';
import type { MemoItem } from './MemoTimeline';

interface CalendarDay { plansOpen: number; plansTotal: number; memos: number; collected: number }
type DayMap = Record<string, CalendarDay>;

interface ClipLite { articleId: string; createdAt: string }

const WEEK_HEADS = ['一', '二', '三', '四', '五', '六', '日'] as const;

function monthOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
}

function dayKeyOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export default function MemoCalendar() {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [days, setDays] = useState<DayMap>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [dayMemos, setDayMemos] = useState<MemoItem[]>([]);
  const [dayClips, setDayClips] = useState<Array<{ articleId: string; title: string | null }>>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const loadMonth = useCallback(async (m: string) => {
    try {
      const res = await apiFetch(`/s/api/memos/calendar?month=${m}`);
      const json = await res.json();
      if (json.ok) setDays((json.data.days ?? {}) as DayMap);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMonth(month);
  }, [loadMonth, month]);

  const loadDay = useCallback(async (day: string) => {
    setDayLoading(true);
    try {
      const [memoRes, clipRes] = await Promise.all([
        apiFetch(`/s/api/memos?day=${day}`),
        apiFetch('/s/api/clips?limit=100'),
      ]);
      const memoJson = await memoRes.json();
      setDayMemos(memoJson.ok ? ((memoJson.data.items ?? []) as MemoItem[]) : []);
      const clipJson = await clipRes.json();
      if (clipJson.ok) {
        const all = (clipJson.data.items ?? []) as Array<ClipLite & { sourceTitle?: string | null }>;
        setDayClips(
          all
            .filter((c) => c.createdAt.slice(0, 10) === day)
            .map((c) => ({ articleId: c.articleId, title: c.sourceTitle ?? null })),
        );
      }
    } catch {
      // 静默
    } finally {
      setDayLoading(false);
    }
  }, []);

  const selectDay = useCallback((day: string) => {
    setSelected((cur) => (cur === day ? null : day));
    if (day) void loadDay(day);
  }, [loadDay]);

  // 月历格子：周一开头
  const cells = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00`);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const list: Array<{ day: string | null }> = Array.from({ length: lead }, () => ({ day: null }));
    for (let d = 1; d <= total; d += 1) list.push({ day: dayKeyOf(new Date(first.getFullYear(), first.getMonth(), d)) });
    return list;
  }, [month]);

  const todayKey = dayKeyOf(new Date());
  const monthLabel = `${Number(month.slice(5, 7))} 月`;

  const shiftMonth = (delta: number) => {
    const d = new Date(`${month}-01T00:00:00`);
    d.setMonth(d.getMonth() + delta);
    setMonth(monthOf(d));
    setSelected(null);
  };

  return (
    <div className="space-y-3">
      <div className="glass-surface rounded-2xl p-3">
        <div className="flex items-center">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => shiftMonth(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="flex-1 text-center text-[13px] font-medium">{monthLabel}</span>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => shiftMonth(1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-0.5 text-center">
          {WEEK_HEADS.map((w) => (
            <span key={w} className="py-1 text-[10px] text-muted-foreground">{w}</span>
          ))}
          {cells.map(({ day }, i) => {
            if (!day) return <span key={`blank-${i}`} />;
            const info = days[day];
            const hasPlan = (info?.plansTotal ?? 0) > 0;
            const hasCollected = (info?.collected ?? 0) > 0;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected === day}
                onClick={() => selectDay(day)}
                className={cn(
                  'flex h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[12px] transition-colors',
                  selected === day ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-accent',
                  day === todayKey && selected !== day && 'font-semibold text-foreground',
                )}
              >
                <span className={cn('leading-none', day === todayKey && 'underline decoration-primary/60 underline-offset-2')}>
                  {Number(day.slice(8))}
                </span>
                <span className="flex h-2 items-center gap-0.5">
                  {hasPlan ? (
                    <span className={cn(
                      'inline-flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[8px] font-bold leading-none text-white',
                      (info?.plansOpen ?? 0) > 0 ? 'bg-amber-500' : 'bg-muted-foreground/50',
                    )}>
                      {info?.plansOpen ?? 0}
                    </span>
                  ) : null}
                  {hasCollected ? <span className="h-1.5 w-1.5 rounded-full bg-primary/70" /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 flex items-center justify-center gap-3 text-[9px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[8px] font-bold text-white">1</span> 待办计划</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-primary/70" /> 当天有收录</span>
        </p>
      </div>

      {/* 当日详情：到期/当天计划 + 随记 + 当天收藏 */}
      {selected ? (
        <div className="glass-surface rounded-2xl p-3">
          <h3 className="text-[12px] font-medium text-foreground">{selected === todayKey ? '今天' : selected} 的安排</h3>
          {dayLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {dayMemos.map((memo) => (
                <div key={memo.id} className="rounded-xl bg-secondary/40 px-3 py-2">
                  <p className={cn('whitespace-pre-wrap break-words text-[12px] leading-relaxed', memo.kind === 'plan' && memo.doneAt ? 'text-muted-foreground line-through' : 'text-foreground')}>
                    {memo.kind === 'plan' ? '📌 ' : ''}{memo.content}
                  </p>
                </div>
              ))}
              {dayClips.map((clip) => (
                <div key={clip.articleId} className="rounded-xl bg-primary/5 px-3 py-2">
                  <p className="truncate text-[12px] text-primary">🔖 {clip.title ?? '收藏内容'}</p>
                </div>
              ))}
              {dayMemos.length === 0 && dayClips.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">这一天没有安排和收录</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
