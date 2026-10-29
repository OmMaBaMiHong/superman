'use client';

/**
 * 收藏保存目录（Obsidian vault 关联）：
 * 文本写成 Markdown、图片/视频源文件写进 attachments/，库里只存链接。
 * webview 没有原生目录选择器，直接填本机绝对路径，服务端校验可写并探测 .obsidian。
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderSymlink, Loader2, Sparkles } from 'lucide-react';
import { toast } from '@/features/toast/toast';
import { apiFetch } from '../lib/auth';

interface DirStatus {
  dir: string;
  exists: boolean;
  writable: boolean;
  isVault: boolean;
}

export default function FavoriteDirPanel() {
  const [status, setStatus] = useState<DirStatus | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [maintaining, setMaintaining] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/s/api/me/favorites/dir');
      const json = await res.json();
      if (json.ok) {
        setStatus(json.data as DirStatus);
        setValue(typeof json.data.dir === 'string' ? json.data.dir : '');
      }
    } catch {
      // 静默：保留旧值
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/s/api/me/favorites/dir', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: value.trim() }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? '保存失败');
      setStatus(json.data as DirStatus);
      toast.success(json.data.dir ? (json.data.isVault ? '已关联 Obsidian vault' : '已保存') : '已清除，回退默认存储');
      window.dispatchEvent(new CustomEvent('superman:favorites-dir-changed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [value]);

  // 整理已有收藏：老收藏的图/视频复制进目录 + 给视频补首帧封面
  const maintenance = useCallback(async () => {
    setMaintaining(true);
    try {
      const res = await apiFetch('/s/api/me/favorites/maintenance', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? '整理失败');
      const { notes, posters, hasDir } = json.data as { notes: number; posters: number; hasDir: boolean };
      toast.success(
        hasDir
          ? `已整理：${notes} 条收藏写入目录、${posters} 个视频封面`
          : `已生成 ${posters} 个视频封面（未配置目录，只做了封面）`,
      );
      window.dispatchEvent(new CustomEvent('superman:clips-changed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '整理失败');
    } finally {
      setMaintaining(false);
    }
  }, []);

  const hint = !status?.dir
    ? '未设置：收藏仅存插件数据库'
    : !status.exists
      ? '目录不存在，保存时自动创建'
      : !status.writable
        ? '目录不可写，请检查权限'
        : status.isVault
          ? '已关联 Obsidian vault'
          : '普通目录（未检测到 .obsidian）';

  return (
    <section aria-label="收藏保存目录" className="glass-surface p-5">
      <div className="flex items-center gap-2">
        <FolderSymlink aria-hidden="true" className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">收藏保存目录</h2>
        {status?.dir && status.exists && status.writable && status.isVault ? (
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
        ) : null}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        文本存为 Markdown、图片视频存进 attachments/，Obsidian 打开即读
      </p>
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="/Users/xxx/my-vault（本机绝对路径）"
        spellCheck={false}
        className="mt-3 h-10 w-full rounded-xl border border-border bg-card px-3.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void maintenance()}
          disabled={maintaining}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {maintaining ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />}
          {maintaining ? '整理中…' : '整理已有收藏（写入目录 + 视频封面）'}
        </button>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span
          className={
            status?.dir && status.exists && status.writable
              ? 'min-w-0 truncate text-[11px] text-primary/90'
              : 'min-w-0 truncate text-[11px] text-muted-foreground'
          }
        >
          {hint}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || value.trim() === (status?.dir ?? '')}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        >
          {saving ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? '校验中…' : '保存'}
        </button>
      </div>
    </section>
  );
}
