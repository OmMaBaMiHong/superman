'use client';

/**
 * 生成同款视频（Remake）：选同款 → 对标文案（可编辑）→ 店名/卖点 → 传 6 张相片 → 出片。
 * 数据链：相片(base64) → /s/api/waveforge/create → WaveForge 引擎 → 分镜预览。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/auth';
import { loadRemakePreview } from '../lib/waveforge';

interface SlotDef {
  k: string;
  hint: string;
}

const TEMPLATE = {
  id: 'bbq-store-v1',
  name: '深夜排队王',
  industry: '烧烤',
  emoji: '🍢',
  durationSec: 26,
  slots: [
    { k: '招牌', hint: '带 logo 最醒目' },
    { k: '门脸', hint: '门口或排队的样子' },
    { k: '店内环境', hint: '大厅、餐桌、烟火气' },
    { k: '招牌菜', hint: '最有名的那道拍近点' },
    { k: '价格', hint: '价目表拍清楚' },
    { k: '地址', hint: '门口或定位' },
  ] as SlotDef[],
};

interface SlotState {
  status: 'empty' | 'uploading' | 'filled';
  base64?: string;
  preview?: string;
}

/** 粗略剥 HTML 标签：文章正文 → 纯文本对标文案 */
function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function RemakePage() {
  const [sourceText, setSourceText] = useState('');
  const [benchLoading, setBenchLoading] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [note, setNote] = useState('');
  const [slots, setSlots] = useState<Record<string, SlotState>>(() =>
    Object.fromEntries(TEMPLATE.slots.map((s) => [s.k, { status: 'empty' as const }])));
  const [session] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `s${Date.now()}${Math.random().toString(36).slice(2)}`));
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobSteps, setJobSteps] = useState<Array<{ step: string; finishedAt?: string; error?: string }>>([]);
  const [jobError, setJobError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const doneCount = useMemo(() => Object.values(slots).filter((s) => s.status === 'filled').length, [slots]);

  const loadBenchmark = useCallback(async (articleId: string) => {
    setBenchLoading(true);
    try {
      const res = await apiFetch(`/api/articles/${encodeURIComponent(articleId)}`, { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const d = await res.json();
      const article = d?.article ?? d;
      const text =
        (article?.video?.transcriptText as string | undefined)?.trim() ||
        htmlToText(article?.contentHtml as string | undefined) ||
        (article?.clip?.rawContent as string | undefined)?.trim() ||
        '';
      if (text) setSourceText(text.slice(0, 6000));
    } finally {
      setBenchLoading(false);
    }
  }, []);

  // ?article=<id>：从选题/收藏进来时自动带上爆款文案
  useEffect(() => {
    const query = (window.location.hash.split('?')[1] ?? '');
    const article = new URLSearchParams(query).get('article');
    if (article) void loadBenchmark(article);
  }, [loadBenchmark]);

  async function uploadSlot(slotK: string, file: File) {
    setSlots((s) => ({ ...s, [slotK]: { status: 'uploading' } }));
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? '').split(',')[1] ?? '';
      setSlots((s) => ({ ...s, [slotK]: { status: 'filled', base64, preview: URL.createObjectURL(file) } }));
    };
    reader.onerror = () => setSlots((s) => ({ ...s, [slotK]: { status: 'empty' } }));
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const photos = TEMPLATE.slots
        .map((s) => ({ name: `${s.k}.jpg`, base64: slots[s.k]?.base64 ?? '' }))
        .filter((p) => p.base64);
      const data = await (await import('../lib/waveforge')).createRemakeJob({
        templateId: TEMPLATE.id,
        storeName,
        note,
        session,
        photos,
        sourceText: sourceText || undefined,
      });
      setJobId(data.id);
      setJobStatus('queued');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  // 轮询任务进度
  useEffect(() => {
    if (!jobId || jobStatus === 'done' || jobStatus === 'failed') return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const waveforge = await import('../lib/waveforge');
        const job = await waveforge.fetchRemakeJob(jobId);
        if (!alive) return;
        if (!job) { setJobError('任务不存在'); return; }
        setJobStatus(job.status);
        setJobSteps(job.steps ?? []);
        setJobError(job.error ?? '');
        if (job.status === 'done') {
          try {
            setPreviewUrl(await waveforge.loadRemakePreview(jobId));
          } catch { setPreviewUrl(''); }
          return;
        }
        if (job.status === 'failed') { setJobError(job.error ?? '引擎处理失败'); return; }
      } catch { /* 网络抖动下一轮重试 */ }
      setTimeout(poll, 2500);
    };
    void poll();
    return () => { alive = false; };
  }, [jobId, jobStatus]);

  const stepsDone = jobSteps.filter((s) => s.finishedAt && !s.error).length;
  const pct = jobStatus === 'done' ? 100 : jobStatus === 'failed' ? 100 : Math.min(92, Math.round((stepsDone / TEMPLATE.slots.length) * 100));

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-28 pt-6">
      <h1 className="text-xl font-black">生成同款视频</h1>
      <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
        同款 = 已经拍火的拍法，换成您自己的相片就是您店的视频
      </p>

      {/* ── ① 选同款 ── */}
      <section className="mt-5">
        <h2 className="text-[15px] font-bold">① 选同款</h2>
        <div
          className="mt-2 flex items-center gap-3 rounded-2xl border-2 p-3"
          style={{ borderColor: 'var(--brand-end-a)', background: 'var(--card, #fff)' }}
        >
          <span className="text-4xl" aria-hidden="true">{TEMPLATE.emoji}</span>
          <div className="flex-1">
            <b className="block text-[15px]">{TEMPLATE.name}</b>
            <span className="text-[12px] text-[var(--text-tertiary)]">{TEMPLATE.industry} · {TEMPLATE.durationSec} 秒左右</span>
          </div>
          <span className="rounded-full bg-[var(--brand-tint)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-ink)]">已选</span>
        </div>
      </section>

      {/* ── ② 对标文案 ── */}
      <section className="mt-5">
        <h2 className="text-[15px] font-bold">② 对标文案 <span className="text-[12px] font-normal text-[var(--text-tertiary)]">（可编辑，引擎按它的结构改写成您的店）</span></h2>
        {benchLoading ? (
          <p className="mt-2 text-[13px] text-[var(--text-tertiary)]">正在载入选题的视频文案…</p>
        ) : (
          <textarea
            className="mt-2 w-full rounded-xl border p-3 text-[14px] leading-relaxed"
            style={{ borderColor: 'var(--line)', minHeight: 110, background: 'var(--card, #fff)' }}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="粘贴对标视频的文案，或从选题池「生成同款视频」进入自动带出"
            maxLength={6000}
          />
        )}
      </section>

      {/* ── ③ 您的店 ── */}
      <section className="mt-5">
        <h2 className="text-[15px] font-bold">③ 您的店</h2>
        <div className="mt-2 grid gap-2.5">
          <input
            className="w-full rounded-xl border p-3 text-[15px]"
            style={{ borderColor: 'var(--line)', background: 'var(--card, #fff)' }}
            placeholder="店名（必填）"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            maxLength={30}
          />
          <input
            className="w-full rounded-xl border p-3 text-[15px]"
            style={{ borderColor: 'var(--line)', background: 'var(--card, #fff)' }}
            placeholder="想让顾客知道的：人均、招牌菜…（选填）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
          />
        </div>
      </section>

      {/* ── ④ 相片 ── */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold">④ 您的相片</h2>
          <span className="text-[12px] text-[var(--text-tertiary)]">{doneCount} / {TEMPLATE.slots.length}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2.5">
          {TEMPLATE.slots.map((slot) => {
            const st = slots[slot.k] ?? { status: 'empty' as const };
            return (
              <div
                key={slot.k}
                className="relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-xl text-[12px]"
                style={{
                  border: st.status === 'filled' ? '1.5px solid var(--success)' : '1.5px dashed var(--line)',
                  background: 'var(--card, #fff)', color: 'var(--text-tertiary)',
                }}
                title={slot.hint}
              >
                {st.status === 'uploading' && <span>上传中…</span>}
                {st.status === 'empty' && (
                  <button type="button" className="flex flex-col items-center gap-1" onClick={() => fileRefs.current[slot.k]?.click()}>
                    <span className="text-2xl font-light">＋</span>
                    <span>{slot.k}</span>
                  </button>
                )}
                {st.status === 'filled' && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={st.preview} alt={slot.k} className="absolute inset-0 h-full w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[11px] text-white">{slot.k}</span>
                  </>
                )}
                <input
                  ref={(el) => { fileRefs.current[slot.k] = el; }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadSlot(slot.k, file);
                    e.target.value = '';
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>

      {submitError && (
        <div className="mt-4 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-[14px]">{submitError}</div>
      )}

      {/* ── 提交 / 进度 / 成片 ── */}
      {!jobId && (
        <button
          type="button"
          className="mt-6 w-full rounded-2xl p-4 text-[17px] font-extrabold text-white disabled:opacity-45"
          style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand2))', '--tw-shadow': 'none' } as React.CSSProperties}
          disabled={doneCount === 0 || !storeName.trim() || sourceText.length < 10 || submitting}
          onClick={() => void submit()}
        >
          {submitting ? '创建中…'
            : doneCount === 0 ? '先传一张相片'
            : sourceText.length < 10 ? '先补上对标文案'
            : !storeName.trim() ? '填上店名就能开始'
            : '素材齐了，开始创作 →'}
        </button>
      )}

      {jobId && jobStatus !== 'done' && jobStatus !== 'failed' && (
        <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: 'var(--line)' }}>
          <div className="font-bold">正在做您的视频</div>
          <div className="mt-3 grid gap-2.5">
            {jobSteps.map((s) => (
              <div key={s.step} className="flex items-center gap-2.5 text-[14px]">
                <span>{s.finishedAt ? '✅' : '⏳'}</span>
                <span>{s.step}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-sunken)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(135deg, var(--brand), var(--brand2))' }} />
          </div>
          <div className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">{pct}% · 别关页面，好了自动显示</div>
        </div>
      )}

      {jobStatus === 'failed' && (
        <div className="mt-6 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-[14px]">
          这次没做成：{jobError || '引擎处理失败'}。相片还在，改一改再点「开始创作」。
        </div>
      )}

      {jobStatus === 'done' && (
        <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: 'var(--line)' }}>
          <div className="font-bold">做好了！</div>
          {previewUrl ? (
            <iframe src={previewUrl} title="分镜预览" className="mt-3 h-[430px] w-full rounded-xl border-0" style={{ background: '#0F1014' }} />
          ) : (
            <p className="mt-2 text-[13px] text-[var(--text-tertiary)]">分镜装配中，刷新页面再看…</p>
          )}
          <a className="btn btn-primary mt-3 block text-center" href={previewUrl} target="_blank" rel="noreferrer">新窗口打开分镜</a>
        </div>
      )}

      <div className="mt-6 text-center text-[11px] text-[var(--text-tertiary)]">成片由 AI 生成 · 当前为分镜预览版，成片渲染马上来</div>
    </div>
  );
}
