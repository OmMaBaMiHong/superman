import { useCallback, useEffect, useState } from 'react';
import { getAiModelSettings, listFreeModels, saveAiModelSettings, testFreeModel } from '@/lib/api/apiClient';
import type { FreeModelOption, FreeModelSettings } from '@/lib/ai/freeModelConfig';

const buttonClass = 'min-h-11 rounded-full border border-border px-4 text-xs disabled:opacity-50';
const fieldClass = 'mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm';

export default function FreeModelsPanel() {
  const [settings, setSettings] = useState<FreeModelSettings | null>(null);
  const [models, setModels] = useState<FreeModelOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const showError = (err: unknown) => setError(err instanceof Error ? err.message : '操作失败，请重试');

  useEffect(() => {
    let active = true;
    getAiModelSettings().then((value) => { if (active) setSettings(value); }).catch((err) => { if (active) showError(err); });
    return () => { active = false; };
  }, []);

  const refreshModels = useCallback(async () => {
    setLoading(true); setError('');
    try { setModels((await listFreeModels()).items ?? []); } catch (err) { setError(err instanceof Error ? err.message : '模型列表加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (settings?.providerMode === 'kilo-free') void refreshModels();
  }, [settings?.providerMode, refreshModels]);

  async function submit(test: boolean) {
    if (!settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (test) {
        const result = await testFreeModel(settings.freeModel);
        setMessage(`连接成功 · ${result.model} · ${result.text}`);
      } else {
        setSettings(await saveAiModelSettings(settings));
        setMessage('模型设置已保存');
      }
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  }

  const free = settings?.providerMode === 'kilo-free';
  const available = models.some((model) => model.id === settings?.freeModel);
  return <section aria-label="AI 模型" className="glass-surface space-y-4 p-5">
    <div><h2 className="text-sm font-semibold">AI 模型</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">用于插件内的内容治理、改写和问答。</p></div>
    {!settings ? <p className="text-xs text-muted-foreground">{error || '正在加载模型设置…'}</p> : <>
      <label className="block text-xs">模型来源
        <select aria-label="模型来源" className={fieldClass} value={settings.providerMode} disabled={busy} onChange={(event) => { setSettings({ ...settings, providerMode: event.target.value as FreeModelSettings['providerMode'] }); setMessage(''); setError(''); }}>
          <option value="configured">沿用现有模型配置</option><option value="kilo-free">免费模型 · Kilo</option>
        </select>
      </label>
      {free && <>
        <p className="text-xs leading-relaxed text-muted-foreground">无需 API Key，由运行 DSH 的设备连接 Kilo。内容将发送至 Kilo 及模型提供方，部分免费模型会记录输入和输出；免费额度与可用性由服务方决定。</p>
        <label className="block text-xs">免费模型
          <select aria-label="免费模型" className={fieldClass} value={settings.freeModel} disabled={busy || loading} onChange={(event) => { setSettings({ ...settings, freeModel: event.target.value }); setMessage(''); }}>
            {!available && <option value={settings.freeModel}>{loading ? '加载模型列表…' : `${settings.freeModel}（待验证）`}</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={busy || loading} onClick={() => void refreshModels()}>刷新模型列表</button>
          <button className={buttonClass} disabled={busy || loading || !available} onClick={() => void submit(true)}>测试免费模型</button>
        </div>
      </>}
      <button className={`${buttonClass} w-full bg-primary text-primary-foreground`} disabled={busy || (free && (loading || !available))} onClick={() => void submit(false)}>{busy ? '处理中…' : '保存模型设置'}</button>
    </>}
    {error && settings && <p role="alert" className="text-xs text-error">{error}</p>}
    {message && <p role="status" className="break-words text-xs text-primary">{message}</p>}
  </section>;
}
