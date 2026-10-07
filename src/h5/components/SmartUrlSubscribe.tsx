'use client';

import { Loader2, Search, Sparkles, Star } from 'lucide-react';
import { useCallback, useState } from 'react';
import { createFeed, resolveRssHubSourceUrl, type RssHubSourceResolveResult } from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import { cn } from '@/lib/utils';

interface SmartUrlSubscribeProps {
  /** 订阅成功后回调 */
  onSubscribed?: () => void;
}

type AnalyzeState = 'idle' | 'analyzing' | 'done' | 'error';

/**
 * 智能订阅组件 — 复用宿主 resolveRssHubSourceUrl（RSSHub radar 规则 + 抖音特判）。
 * 支持直接粘贴整段分享文字，自动提取其中的真实链接。
 */
export default function SmartUrlSubscribe({ onSubscribed }: SmartUrlSubscribeProps) {
  const [text, setText] = useState('');
  const [state, setState] = useState<AnalyzeState>('idle');
  const [result, setResult] = useState<RssHubSourceResolveResult | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  const analyze = useCallback(async () => {
    if (!text.trim()) { toast.info('请粘贴链接或分享内容'); return; }
    setState('analyzing');
    setResult(null);

    try {
      const res = await resolveRssHubSourceUrl(text.trim());
      setResult(res);
      setState(res.resolved ? 'done' : 'error');
    } catch {
      setState('error');
      toast.error('识别失败，请稍后重试');
    }
  }, [text]);

  const subscribe = useCallback(async () => {
    if (!result?.resolved || !result.rssHubUrl) return;
    setSubscribing(true);
    try {
      await createFeed({
        title: result.title?.trim() || '订阅',
        url: result.rssHubUrl,
        siteUrl: result.finalUrl ?? null,
      });
      toast.success(`已订阅「${result.title?.trim() || '订阅'}」`);
      setText('');
      setResult(null);
      setState('idle');
      onSubscribed?.();
    } catch {
      // apiClient 已统一 toast 错误
    } finally {
      setSubscribing(false);
    }
  }, [result, onSubscribed]);

  const analyzing = state === 'analyzing';

  return (
    <div className="space-y-3">
      {/* 输入：整段分享文字或链接 */}
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setState('idle'); setResult(null); }}
        placeholder={'直接粘贴分享内容即可，例如：\n「开源项目graft… https://v.douyin.com/xxx/ 复制此链接，打开抖音搜索…」'}
        rows={3}
        className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {analyzing ? '识别中…抖音作品需解析作者，约 5-10 秒' : '自动提取链接 · 识别博主'}
        </p>
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing || !text.trim()}
          className="flex h-8 items-center gap-1 rounded-full bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          识别
        </button>
      </div>

      {/* 解析结果 */}
      {result && (
        <div className={cn(
          'rounded-2xl border p-3',
          result.resolved ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5',
        )}>
          {result.resolved ? (
            <>
              <p className="text-sm font-medium">{result.title || '已识别订阅源'}</p>
              {result.rssHubUrl && (
                <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{result.rssHubUrl}</p>
              )}
              <button
                type="button"
                onClick={subscribe}
                disabled={subscribing}
                className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-success px-4 text-xs font-medium text-success-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {subscribing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
                订阅
              </button>
            </>
          ) : (
            <p className="text-xs text-warning">{result.message || '未能识别该链接'}</p>
          )}
        </div>
      )}

      {/* 快捷提示 */}
      <p className="flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
        支持抖音/B站/微博/小红书/YouTube/知乎等（内置 RSSHub radar 规则）。
        整段分享文字直接粘贴即可，会自动提取其中的链接。
      </p>
    </div>
  );
}
