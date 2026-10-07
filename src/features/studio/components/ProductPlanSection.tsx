'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  ScanSearch,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  createProductPlan,
  deleteProductPlan,
  getProductPlanStats,
  listProductPlans,
  runProductPlanPipeline,
  scanProductPlans,
  updateProductPlan,
  type ProductPlanItem,
  type ProductPlanPipeline,
  type ProductPlanSourceType,
  type ProductPlanStats,
  type ProductPlanStatus,
  type ProductPlanStepKey,
  type ProductPlanStepStatus,
} from '@/lib/api/apiClient';
import GlassDetailSheet from '@/components/ui/glass-detail-sheet';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';

type StatusFilter = ProductPlanStatus | 'all';

const STATUS_ORDER: ProductPlanStatus[] = ['idea', 'validating', 'building', 'launched', 'archived'];

const STATUS_META: Record<ProductPlanStatus, { label: string; badge: string; dot: string }> = {
  idea: { label: '想法', badge: 'border-border bg-secondary text-muted-foreground', dot: 'bg-muted-foreground' },
  validating: { label: '验证中', badge: 'border-warning/40 bg-warning/10 text-warning', dot: 'bg-warning' },
  building: { label: '开发中', badge: 'border-primary/40 bg-primary/10 text-primary', dot: 'bg-primary' },
  launched: { label: '已上线', badge: 'border-success/40 bg-success/10 text-success', dot: 'bg-success' },
  archived: { label: '已归档', badge: 'border-border bg-secondary text-muted-foreground/70', dot: 'bg-muted-foreground/50' },
};

const SOURCE_META: Record<ProductPlanSourceType, { label: string; className: string }> = {
  manual: { label: '口述想法', className: 'border-primary/30 bg-primary/5 text-primary/90' },
  ai_inferred: { label: 'AI 推理', className: 'border-warning/30 bg-warning/5 text-warning/90' },
};

const STEP_ORDER: ProductPlanStepKey[] = ['source', 'transcript', 'analysis', 'remix'];

const STEP_LABEL: Record<ProductPlanStepKey, string> = {
  source: '来源',
  transcript: '文案',
  analysis: '产品化',
  remix: '二创思路',
};

function StepStatusIcon({ status }: { status: ProductPlanStepStatus }) {
  if (status === 'done') return <CircleCheck aria-hidden="true" className="h-3.5 w-3.5 text-success" />;
  if (status === 'failed') return <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-warning" />;
  if (status === 'running') return <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-primary" />;
  return <CircleDashed aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground/50" />;
}

/** 流水线状态条：来源 → 文案 → 产品化 → 二创思路。 */
function PipelineRow({ pipeline }: { pipeline: ProductPlanPipeline | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
      {STEP_ORDER.map((key, index) => {
        const step = pipeline?.[key];
        const status = step?.status ?? 'pending';
        return (
          <span key={key} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={step?.note ?? ''}>
            {index > 0 ? <span aria-hidden="true" className="text-muted-foreground/40">→</span> : null}
            <StepStatusIcon status={status} />
            <span className={cn(status === 'failed' && 'text-warning', status === 'done' && 'text-foreground/80')}>
              {STEP_LABEL[key]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** 计划字段编辑表（顺序即详情里的展示顺序）。 */
const EDIT_FIELDS: Array<{ key: keyof ProductPlanItem; label: string; hint: string; rows: number }> = [
  { key: 'oneLiner', label: '一句话', hint: '这是什么产品、为谁解决什么问题', rows: 2 },
  { key: 'direction', label: '产品化方向', hint: '最适合做成什么形态（短剧/漫剧/工具/服务…）', rows: 2 },
  { key: 'productDesc', label: '产品描述', hint: '核心功能与形态', rows: 3 },
  { key: 'targetUsers', label: '目标人群 / 客户', hint: '谁会付费', rows: 2 },
  { key: 'approach', label: '思路打法', hint: '先做什么、怎么冷启动', rows: 3 },
  { key: 'businessModel', label: '商业模式', hint: '怎么赚钱', rows: 2 },
  { key: 'pricing', label: '定价思路', hint: '定价与收费方式', rows: 2 },
  { key: 'competitors', label: '竞品与差异化', hint: '同类产品 / 你的差异点', rows: 2 },
  { key: 'risks', label: '风险与不确定项', hint: '最大的坑', rows: 2 },
  { key: 'milestones', label: '里程碑', hint: '阶段目标', rows: 2 },
  { key: 'validationPlan', label: 'MVP 验证计划', hint: '最小验证动作与成功标准', rows: 3 },
  { key: 'remixIdeas', label: '二创思路', hint: '短剧/漫剧分镜、口播选题、图文 等具体改编方向', rows: 4 },
];

/** 2026-09-18T… → 09-18 14:30 */
function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** 创作台「产品计划」分区：人工想法 + AI 内容推理两个来源，汇成一份份 MVP 规划。 */
export default function ProductPlanSection() {
  const [plans, setPlans] = useState<ProductPlanItem[]>([]);
  const [stats, setStats] = useState<ProductPlanStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [detail, setDetail] = useState<ProductPlanItem | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [list, statsResult] = await Promise.all([
        listProductPlans(
          { status: filter === 'all' ? undefined : filter, limit: 60 },
          { notifyOnError: false },
        ),
        getProductPlanStats({ notifyOnError: false }),
      ]);
      setPlans(list.items);
      setStats(statsResult);
    } catch {
      // 静默
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleScan = useCallback(() => {
    if (scanning) return;
    setScanning(true);
    void scanProductPlans({ limit: 10 })
      .then((result) => {
        if (result.created > 0) {
          toast.success(`扫描 ${result.scanned} 篇，生成 ${result.created} 个产品计划`);
          void load(true);
        } else {
          toast.info(result.scanned > 0 ? '候选内容都已有计划' : '暂无「搞钱」方向的归档内容');
        }
      })
      .catch(() => {})
      .finally(() => setScanning(false));
  }, [scanning, load]);

  const handleCreated = useCallback(() => {
    setCreating(false);
    void load(true);
  }, [load]);

  const handleDetailSaved = useCallback(
    (plan: ProductPlanItem) => {
      setPlans((current) => current.map((item) => (item.id === plan.id ? plan : item)));
      setDetail(plan);
      void load(true);
    },
    [load],
  );

  const handleDeleted = useCallback(() => {
    setDetail(null);
    toast.success('已删除产品计划');
    void load(true);
  }, [load]);

  return (
    <section aria-label="产品计划">
      {/* 头部：说明 + 操作 */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-[12px] text-muted-foreground">
          把「一个想法」或「一条搞钱内容」整理成产品 MVP 规划：产品描述 / 目标人群 / 思路 / 商业模式 / 风险 / 验证计划。
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={scanning}
            onClick={handleScan}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 sm:h-9',
              'text-xs font-medium text-muted-foreground transition-all duration-150 hover:border-primary/40 hover:text-primary active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
            )}
          >
            {scanning ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanSearch aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            扫描搞钱内容
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 sm:h-9',
              'text-xs font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            记一个想法
          </button>
        </div>
      </div>

      {/* 统计条 */}
      {stats ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">共 {stats.total} 个计划</span>
          <span>口述 {stats.manual}</span>
          <span>AI 推理 {stats.aiInferred}</span>
        </div>
      ) : null}

      {/* 状态筛选 */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
          全部
        </FilterPill>
        {STATUS_ORDER.map((status) => (
          <FilterPill key={status} active={filter === status} onClick={() => setFilter(status)}>
            {STATUS_META[status].label}
            {stats ? <span className="ml-1 font-mono tabular-nums opacity-60">{stats.byStatus[status]}</span> : null}
          </FilterPill>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="gov-card h-40 animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-[1.25rem] border border-dashed border-border px-6 py-16 text-center">
          <Lightbulb aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">
            {filter === 'all' ? '还没有产品计划' : '这个状态下没有计划'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            点「记一个想法」口述一个点子，或「扫描搞钱内容」让 AI 从归档内容里找机会。
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onOpen={() => setDetail(plan)} />
          ))}
        </div>
      )}

      <ProductPlanCreateSheet open={creating} onClose={() => setCreating(false)} onCreated={handleCreated} />

      <GlassDetailSheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        ariaLabel={detail ? `产品计划：${detail.title}` : '产品计划'}
      >
        {detail ? (
          <ProductPlanDetailView
            key={detail.id}
            plan={detail}
            onSaved={handleDetailSaved}
            onDeleted={handleDeleted}
          />
        ) : null}
      </GlassDetailSheet>
    </section>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function PlanCard({ plan, onOpen }: { plan: ProductPlanItem; onOpen: () => void }) {
  const status = STATUS_META[plan.status];
  const source = SOURCE_META[plan.sourceType];
  return (
    <button
      type="button"
      data-testid="product-plan-card"
      data-plan-id={plan.id}
      onClick={onOpen}
      className="gov-card flex w-full flex-col p-4 text-left [--gov-accent:var(--color-primary)]"
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium', status.badge)}>
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
        <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium', source.className)}>
          {source.label}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {formatUpdatedAt(plan.updatedAt)}
        </span>
      </div>

      <h3 className="mt-2.5 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
        {plan.title || '未命名产品想法'}
      </h3>
      {plan.oneLiner ? (
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-secondary-foreground">{plan.oneLiner}</p>
      ) : null}

      {plan.pipeline && STEP_ORDER.some((key) => plan.pipeline[key]?.status === 'failed') ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-warning">
          <AlertTriangle aria-hidden="true" className="h-3 w-3" />
          流水线有步骤未完成（打开可补跑）
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
        {plan.sourceUrl ? (
          <a
            href={plan.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-0.5 text-primary/80 transition-colors hover:text-primary"
            aria-label="查看来源内容"
          >
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
            来源
          </a>
        ) : (
          <span>{plan.aiGenerated ? 'AI 生成' : '启发式占位'}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5 text-primary/80">
          <Pencil aria-hidden="true" className="h-3 w-3" />
          编辑
        </span>
      </div>
    </button>
  );
}

/** 口述想法 → 创建 sheet。 */
function ProductPlanCreateSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [rawIdea, setRawIdea] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!rawIdea.trim() || submitting) return;
      setSubmitting(true);
      void createProductPlan({ rawIdea: rawIdea.trim(), note: note.trim() || null })
        .then((result) => {
          toast.success(result.usedFallback ? '已记录（AI 未配置，先占位）' : `已生成产品计划：${result.plan.title}`);
          setRawIdea('');
          setNote('');
          onCreated();
        })
        .catch(() => {})
        .finally(() => setSubmitting(false));
    },
    [rawIdea, note, submitting, onCreated],
  );

  return (
    <GlassDetailSheet open={open} onClose={onClose} ariaLabel="记一个产品想法">
      <form className="space-y-4 px-5 pb-6 pt-1 sm:px-7" onSubmit={handleSubmit}>
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">记一个产品想法</h2>
        </div>
        <p className="text-[12px] text-muted-foreground">
          把你脑子里突然冒出来的点子写下来，AI 会整理成一份可执行的 MVP 规划（没配 AI 也先记着，之后随时补全）。
        </p>

        <div className="space-y-2">
          <label htmlFor="plan-idea-input" className="text-xs font-medium text-muted-foreground">
            产品想法 <span className="text-error">*</span>
          </label>
          <textarea
            id="plan-idea-input"
            required
            rows={6}
            value={rawIdea}
            onChange={(event) => setRawIdea(event.target.value)}
            placeholder="比如：做一个帮自媒体人一键把长文转成口播稿的工具……"
            className="w-full resize-y rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="plan-note-input" className="text-xs font-medium text-muted-foreground">
            补充备注 / 约束（可选）
          </label>
          <input
            id="plan-note-input"
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="面向人群、预算、已有资源……"
            className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!rawIdea.trim() || submitting}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5',
              'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            {submitting ? '整理中…' : '生成计划'}
          </button>
        </div>
      </form>
    </GlassDetailSheet>
  );
}

/** 计划详情 / 编辑 sheet：改字段、切状态、看来源、删除。 */
function ProductPlanDetailView({
  plan,
  onSaved,
  onDeleted,
}: {
  plan: ProductPlanItem;
  onSaved: (plan: ProductPlanItem) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { title: plan.title };
    for (const field of EDIT_FIELDS) {
      initial[field.key] = (plan[field.key] as string | null) ?? '';
    }
    return initial;
  });
  const [status, setStatus] = useState<ProductPlanStatus>(plan.status);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pipeline, setPipeline] = useState<ProductPlanPipeline>(plan.pipeline);
  const [running, setRunning] = useState(false);

  const handleRunPipeline = useCallback(
    (force: boolean) => {
      if (running) return;
      setRunning(true);
      void runProductPlanPipeline(plan.id, { force })
        .then((result) => {
          setPipeline(result.pipeline);
          setStatus(result.plan.status);
          // AI 补全的字段回填到草稿
          setDraft((current) => {
            const next = { ...current };
            for (const field of EDIT_FIELDS) {
              const value = (result.plan as unknown as Record<string, unknown>)[field.key];
              if (typeof value === 'string' && value) next[field.key] = value;
            }
            next.title = result.plan.title || next.title;
            return next;
          });
          onSaved(result.plan);
          toast.success(force ? '已重跑流水线' : '已补齐缺失步骤');
        })
        .catch(() => {})
        .finally(() => setRunning(false));
    },
    [running, plan.id, onSaved],
  );

  const setField = useCallback((key: string, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    if (saving) return;
    setSaving(true);
    void updateProductPlan(plan.id, { ...draft, status })
      .then(({ plan: saved }) => {
        toast.success('已保存');
        onSaved(saved);
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  }, [saving, plan.id, draft, status, onSaved]);

  const handleDelete = useCallback(() => {
    if (deleting) return;
    setDeleting(true);
    void deleteProductPlan(plan.id)
      .then(() => onDeleted())
      .catch(() => {})
      .finally(() => setDeleting(false));
  }, [deleting, plan.id, onDeleted]);

  const statusMeta = STATUS_META[status];
  const sourceMeta = SOURCE_META[plan.sourceType];

  return (
    <div className="space-y-4 px-5 pb-8 pt-1 sm:px-7">
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium', statusMeta.badge)}>
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
          {statusMeta.label}
        </span>
        <span className={cn('inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium', sourceMeta.className)}>
          {sourceMeta.label}
        </span>
        {plan.sourceUrl ? (
          <a
            href={plan.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-primary/80 transition-colors hover:text-primary"
          >
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
            来源内容
          </a>
        ) : null}
      </div>

      {plan.sourceNote ? (
        <p className="rounded-xl border border-border/60 bg-secondary/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">原始想法：</span>
          {plan.sourceNote.slice(0, 240)}
          {plan.sourceNote.length > 240 ? '…' : ''}
        </p>
      ) : null}

      {/* 流水线：来源 → 文案 → 产品化 → 二创思路 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">流水线</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={running}
              onClick={() => handleRunPipeline(false)}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3',
                'text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50',
              )}
            >
              {running ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> : <RotateCw aria-hidden="true" className="h-3 w-3" />}
              补跑缺失
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => handleRunPipeline(true)}
              className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              全部重跑
            </button>
          </div>
        </div>
        <PipelineRow pipeline={pipeline} />
        {pipeline.transcript?.status === 'failed' ? (
          <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
            文案提取失败：{pipeline.transcript.note || '未知原因'}
            {/cookies?|403|Fresh cookies/i.test(pipeline.transcript.note ?? '')
              ? ' —— 抖音需要先在「设置 → 平台 Cookie」里配置抖音 cookies 才能提取文案。'
              : ''}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="plan-title-input" className="text-xs font-medium text-muted-foreground">
          产品名
        </label>
        <input
          id="plan-title-input"
          type="text"
          value={draft.title}
          onChange={(event) => setField('title', event.target.value)}
          className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* 状态切换 */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">状态</span>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={status === entry}
              onClick={() => setStatus(entry)}
              className={cn(
                'inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                status === entry
                  ? STATUS_META[entry].badge
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {STATUS_META[entry].label}
            </button>
          ))}
        </div>
      </div>

      {/* 字段编辑 */}
      <div className="space-y-4">
        {EDIT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-2">
            <label htmlFor={`plan-field-${field.key}`} className="text-xs font-medium text-muted-foreground">
              {field.label}
              <span className="ml-1.5 font-normal text-muted-foreground/60">{field.hint}</span>
            </label>
            <textarea
              id={`plan-field-${field.key}`}
              rows={field.rows}
              value={draft[field.key] ?? ''}
              onChange={(event) => setField(field.key, event.target.value)}
              className="w-full resize-y rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-4">
        <button
          type="button"
          disabled={deleting}
          onClick={handleDelete}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-error/30 px-4',
            'text-sm font-medium text-error transition-colors duration-150 hover:bg-error/10 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          {deleting ? '删除中…' : '删除'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-5',
            'text-sm font-medium text-primary transition-all duration-150 hover:bg-primary/20 active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          {saving ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
