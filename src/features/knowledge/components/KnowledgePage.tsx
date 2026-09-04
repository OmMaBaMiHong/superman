'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Eraser, Loader2, SendHorizontal, Sparkles, Search, Filter, User } from 'lucide-react';
import { askKnowledge } from '@/lib/api/apiClient';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import DetailDrawer from '@/components/glass/DetailDrawer';
import EmptyState from '@/components/glass/EmptyState';
import ErrorState from '@/components/glass/ErrorState';
import { GlassSkeletonList } from '@/components/glass/GlassSkeleton';

const MODE_OPTIONS = [
  { id: 'personal_assistant' as const, label: '个人助手', icon: Bot, description: '基于订阅源内容回答你的问题' },
  { id: 'content_creation' as const, label: '内容创作', icon: Sparkles, description: '根据订阅源信息辅助创作' },
  { id: 'information_filtering' as const, label: '信息筛选', icon: Filter, description: '从订阅源中筛选特定信息' },
];

/** 空态建议问题（原内联数组抽为常量，行为不变）。 */
const SUGGESTED_QUESTIONS = [
  '最近有哪些重要新闻？',
  '帮我总结一下 AI 领域的最新进展',
  '筛选出关于产品发布的信息',
];

/** 来源条目类型从 store 推导，避免在页面里重复声明数据结构。 */
type KnowledgeSource = NonNullable<
  ReturnType<typeof useKnowledgeStore.getState>['messages'][number]['sources']
>[number];

export default function KnowledgePage() {
  const messages = useKnowledgeStore((state) => state.messages);
  const isStreaming = useKnowledgeStore((state) => state.isStreaming);
  const selectedMode = useKnowledgeStore((state) => state.selectedMode);
  const addMessage = useKnowledgeStore((state) => state.addMessage);
  const appendToLastAssistant = useKnowledgeStore((state) => state.appendToLastAssistant);
  const setSourcesForLastAssistant = useKnowledgeStore((state) => state.setSourcesForLastAssistant);
  const setStreaming = useKnowledgeStore((state) => state.setStreaming);
  const clearMessages = useKnowledgeStore((state) => state.clearMessages);
  const setSelectedMode = useKnowledgeStore((state) => state.setSelectedMode);

  const [input, setInput] = useState('');
  const [streamingError, setStreamingError] = useState<string | null>(null);
  // 来源详情抽屉：open 与选中项分开存，关闭动画期间内容不会闪空。
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [activeSource, setActiveSource] = useState<KnowledgeSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSubmit = useCallback(async () => {
    const question = input.trim();
    if (!question || isStreaming) return;

    setInput('');
    setStreamingError(null);
    addMessage({ role: 'user', content: question });
    addMessage({ role: 'assistant', content: '' });
    setStreaming(true);

    await askKnowledge(
      { question, mode: selectedMode },
      (chunk) => {
        appendToLastAssistant(chunk);
      },
      (sources) => {
        setSourcesForLastAssistant(sources);
        setStreaming(false);
      },
      (error) => {
        setStreamingError(error);
        setStreaming(false);
      },
    );
  }, [input, isStreaming, selectedMode, addMessage, appendToLastAssistant, setSourcesForLastAssistant, setStreaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    },
    [],
  );

  const handleModeChange = useCallback(
    (mode: 'personal_assistant' | 'content_creation' | 'information_filtering') => {
      if (mode === selectedMode) return;
      setSelectedMode(mode);
    },
    [selectedMode, setSelectedMode],
  );

  const handleClear = useCallback(() => {
    if (messages.length === 0) return;
    clearMessages();
  }, [messages.length, clearMessages]);

  const handleOpenSource = useCallback((source: KnowledgeSource) => {
    setActiveSource(source);
    setSourceDrawerOpen(true);
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-4 py-6 sm:px-6">
      {/* 顶部标题栏 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">知识库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            基于订阅源内容的智能问答
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={handleClear}
          >
            <Eraser className="h-3.5 w-3.5" />
            清空对话
          </Button>
        )}
      </div>

      {/* 模式选择器 */}
      <div className="mb-6 flex flex-wrap gap-2">
        {MODE_OPTIONS.map((mode) => {
          const Icon = mode.icon;
          const isActive = selectedMode === mode.id;

          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => handleModeChange(mode.id)}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-3.5 py-2 text-left text-sm font-medium transition-all',
                isActive
                  ? 'border-primary/30 bg-primary/15 text-foreground shadow-sm'
                  : 'glass-surface-light text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              <Icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>

      {/* 消息列表：外层面板承担唯一一层玻璃模糊，内部气泡/来源标签一律用非模糊 token，
          避免消息变多后逐条模糊拖垮滚动性能。 */}
      <div className="glass-surface flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {messages.length === 0 ? (
          <EmptyState
            className="flex-1"
            icon={Bot}
            title="开始提问"
            description="基于你的订阅源内容，智能回答你的问题"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          /* 时间轴：左侧一条竖线贯穿，每条消息一个节点圆点，内容在右侧 */
          <div className="relative space-y-6 pb-4">
            <div aria-hidden="true" className="absolute bottom-2 left-4 top-2 w-px bg-primary/20" />

            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isLastMessage = msg === messages[messages.length - 1];
              // 已提交但首个 chunk 未到达：用共享骨架代替空气泡
              const isPending = !isUser && isStreaming && isLastMessage && msg.content === '';

              return (
                <div key={msg.id} className="relative flex gap-3">
                  {/* 时间轴节点：user 为实心圆点，assistant 为描边圆点 */}
                  <div
                    className={cn(
                      'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                      isUser
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-primary/40 bg-card text-primary',
                    )}
                  >
                    {isUser ? (
                      <User aria-hidden="true" className="h-3.5 w-3.5" />
                    ) : (
                      <Bot aria-hidden="true" className="h-4 w-4" />
                    )}
                  </div>

                  <div className="min-w-0 max-w-[85%] space-y-2 sm:max-w-[75%]">
                    {isPending ? (
                      <GlassSkeletonList className="w-56" count={1} />
                    ) : (
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                          isUser
                            ? 'bg-primary/90 text-primary-foreground'
                            : 'border border-border bg-card/60 text-foreground',
                        )}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                          {!isUser && isStreaming && isLastMessage && (
                            <span className="inline-block h-4 w-2 animate-pulse bg-primary/60 align-text-bottom" />
                          )}
                        </div>
                      </div>
                    )}

                    {!isUser && msg.sources && msg.sources.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 px-1">
                        <span className="text-[11px] font-medium text-muted-foreground">来源：</span>
                        {msg.sources.map((source, i) => (
                          <button
                            key={`${source.articleId}-${i}`}
                            type="button"
                            aria-label={`查看来源详情：${source.title}`}
                            onClick={() => handleOpenSource(source)}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          >
                            <Search aria-hidden="true" className="h-3 w-3 shrink-0" />
                            <span className="truncate">{source.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {streamingError && <ErrorState className="py-6" title={streamingError} />}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 底部输入框 */}
      <div className="mt-4 shrink-0">
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="relative"
        >
          <div className="glass-surface-light flex items-end gap-2 rounded-2xl p-2 transition-colors focus-within:border-primary/40">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的问题... (Shift+Enter 换行)"
              rows={1}
              disabled={isStreaming}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isStreaming}
              className="h-9 w-9 shrink-0 rounded-xl"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground/60">
            知识库基于你的订阅源内容提供回答，仅对已处理的文章生效
          </p>
        </form>
      </div>

      {/* 来源详情抽屉：只展示 store 里已有的字段（title / articleId），不新增请求 */}
      <DetailDrawer
        open={sourceDrawerOpen}
        onOpenChange={setSourceDrawerOpen}
        title={activeSource?.title ?? '来源详情'}
        description="该回答引用的订阅源文章"
      >
        {activeSource ? (
          <dl className="space-y-4">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">标题</dt>
              <dd className="mt-1 break-words text-sm text-foreground">{activeSource.title}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">文章 ID</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums text-foreground">
                {activeSource.articleId}
              </dd>
            </div>
          </dl>
        ) : null}
      </DetailDrawer>
    </div>
  );
}